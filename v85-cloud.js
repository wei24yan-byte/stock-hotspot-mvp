(function () {
  "use strict";

  const SESSION_KEY = "market-radar-v85-auth-session";
  const ENTITY_TABLE = "radar_entities";
  const MIGRATION_TABLE = "radar_migrations";
  const SCHEMA_VERSION = 85;
  const CORE_BUCKETS = [
    "stock",
    "plan",
    "trade_log",
    "report",
    "snapshot",
    "setting",
    "dashboard",
    "tombstone"
  ];

  function create(config) {
    return new RadarCloudClient(config);
  }

  class RadarCloudClient {
    constructor(config) {
      this.url = String(config?.url || "").replace(/\/+$/, "");
      this.anonKey = String(config?.anonKey || "");
      this.session = loadSession();
      this.knownEntityKeys = new Set();
      this.entityDigests = new Map();
      this.historyDigests = new Map();
    }

    isConfigured() {
      return Boolean(this.url && this.anonKey);
    }

    isAuthenticated() {
      return Boolean(this.session?.access_token && this.ownerId());
    }

    ownerId() {
      return this.session?.user?.id || jwtSubject(this.session?.access_token);
    }

    sessionEmail() {
      return this.session?.user?.email || jwtEmail(this.session?.access_token) || "";
    }

    consumeAuthRedirect() {
      const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (!accessToken || !refreshToken) return false;
      this.session = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: Math.floor(Date.now() / 1000) + Number(hash.get("expires_in") || 3600),
        token_type: hash.get("token_type") || "bearer",
        user: {
          id: jwtSubject(accessToken),
          email: jwtEmail(accessToken)
        }
      };
      saveSession(this.session);
      history.replaceState(null, "", `${location.pathname}${location.search}`);
      return true;
    }

    async sendMagicLink(email, redirectTo) {
      const response = await fetch(`${this.url}/auth/v1/otp`, {
        method: "POST",
        headers: this.publicHeaders(),
        body: JSON.stringify({
          email: String(email || "").trim(),
          create_user: true,
          email_redirect_to: redirectTo
        })
      });
      if (!response.ok) throw await responseError(response, "发送登录邮件失败");
      return true;
    }

    async signOut() {
      if (this.session?.access_token) {
        await fetch(`${this.url}/auth/v1/logout`, {
          method: "POST",
          headers: this.authHeaders()
        }).catch(() => null);
      }
      this.session = null;
      localStorage.removeItem(SESSION_KEY);
    }

    async ensureSession() {
      if (!this.session?.access_token) return false;
      const expiresAt = Number(this.session.expires_at || 0);
      if (expiresAt > Math.floor(Date.now() / 1000) + 90) return true;
      if (!this.session.refresh_token) return false;
      const response = await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: this.publicHeaders(),
        body: JSON.stringify({ refresh_token: this.session.refresh_token })
      });
      if (!response.ok) {
        await this.signOut();
        return false;
      }
      const next = await response.json();
      this.session = {
        ...next,
        expires_at: Math.floor(Date.now() / 1000) + Number(next.expires_in || 3600),
        user: next.user || {
          id: jwtSubject(next.access_token),
          email: jwtEmail(next.access_token)
        }
      };
      saveSession(this.session);
      return true;
    }

    async loadDashboardState() {
      if (!(await this.ensureSession())) return null;
      const rows = await this.fetchEntities(["dashboard"], "entity_id=eq.primary");
      const row = rows.find((item) => item.entity_id === "primary" && !item.deleted_at);
      return row?.data?.state || null;
    }

    async loadCoreState() {
      if (!(await this.ensureSession())) return null;
      const rows = await this.fetchEntities(CORE_BUCKETS);
      this.rememberEntities(rows);
      return stateFromEntityRows(rows);
    }

    async loadHistory(stockId) {
      if (!(await this.ensureSession())) return [];
      const rows = await this.fetchEntities(["history"], `entity_id=eq.${encodeURIComponent(stockId)}`);
      const row = rows.find((item) => !item.deleted_at);
      const prices = Array.isArray(row?.data?.prices) ? row.data.prices : [];
      this.historyDigests.set(stockId, digest(prices));
      return prices;
    }

    async loadHistories(stockIds) {
      if (!(await this.ensureSession())) return [];
      const ids = [...new Set((stockIds || []).filter(Boolean))];
      if (!ids.length) return [];
      const filter = `entity_id=in.(${ids.map((id) => encodeURIComponent(id)).join(",")})`;
      const rows = await this.fetchEntities(["history"], filter);
      return rows
        .filter((row) => !row.deleted_at)
        .flatMap((row) => {
          const prices = Array.isArray(row?.data?.prices) ? row.data.prices : [];
          this.historyDigests.set(row.entity_id, digest(prices));
          return prices;
        });
    }

    async refreshStock(stockId) {
      if (!(await this.ensureSession())) throw new Error("请先登录 Supabase");
      const response = await fetch(`${this.url}/functions/v1/refresh-stock`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({ stockId })
      });
      if (!response.ok) throw await responseError(response, "服务器补齐日线失败");
      this.historyDigests.delete(stockId);
      return response.json();
    }

    async saveState(state, options = {}) {
      if (!(await this.ensureSession())) throw new Error("请先登录 Supabase");
      const includeHistory = options.includeHistory !== false;
      const rows = entityRowsFromState(state, this.ownerId(), includeHistory);
      const nextRows = rows.filter((row) => {
        const key = `${row.bucket}:${row.entity_id}`;
        const nextDigest = digest(row.data);
        return this.entityDigests.get(key) !== nextDigest;
      });
      nextRows.push(...this.deletedEntityRows(rows));
      if (nextRows.length) await this.upsertEntities(nextRows);
      this.rememberEntities(rows);
      return true;
    }

    async migrateLegacyState(state) {
      if (!(await this.ensureSession())) throw new Error("请先登录 Supabase");
      const rows = entityRowsFromState(state, this.ownerId(), true);
      await upsertInChunks(rows, 80, (chunk) => this.upsertEntities(chunk));
      const counts = migrationCounts(state);
      const checksum = digest({
        stocks: state.stocks,
        prices: state.prices,
        plans: state.plans,
        reports: state.reports,
        tradeLogs: state.tradeLogs,
        snapshots: state.snapshots,
        deletedStocks: state.deletedStocks
      });
      await this.recordMigration("primary-v2-to-v85", checksum, counts);
      this.rememberEntities(rows);
      return { checksum, counts };
    }

    async loadLegacyState(rowId) {
      const response = await fetch(
        `${this.url}/rest/v1/app_state?id=eq.${encodeURIComponent(rowId || "primary-v2")}&select=data`,
        { headers: this.publicHeaders(), cache: "no-store" }
      );
      if (!response.ok) throw await responseError(response, "读取 V84 数据失败");
      const rows = await response.json();
      return rows?.[0]?.data || null;
    }

    async migrationStatus() {
      if (!(await this.ensureSession())) return null;
      const response = await fetch(
        `${this.url}/rest/v1/${MIGRATION_TABLE}?owner_id=eq.${this.ownerId()}&migration_name=eq.primary-v2-to-v85&select=*`,
        { headers: this.authHeaders(), cache: "no-store" }
      );
      if (!response.ok) return null;
      return (await response.json())?.[0] || null;
    }

    publicHeaders() {
      return {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      };
    }

    authHeaders() {
      return {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.session?.access_token || this.anonKey}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      };
    }

    async fetchEntities(buckets, extraQuery) {
      const bucketFilter = `bucket=in.(${buckets.join(",")})`;
      const query = [
        `owner_id=eq.${this.ownerId()}`,
        bucketFilter,
        extraQuery,
        "select=owner_id,bucket,entity_id,data,source_version,deleted_at,updated_at"
      ]
        .filter(Boolean)
        .join("&");
      const response = await fetch(`${this.url}/rest/v1/${ENTITY_TABLE}?${query}`, {
        headers: this.authHeaders(),
        cache: "no-store"
      });
      if (!response.ok) throw await responseError(response, "读取 V85 数据失败");
      return response.json();
    }

    async upsertEntities(rows) {
      const response = await fetch(
        `${this.url}/rest/v1/${ENTITY_TABLE}?on_conflict=owner_id,bucket,entity_id`,
        {
          method: "POST",
          headers: {
            ...this.authHeaders(),
            Prefer: "resolution=merge-duplicates,return=minimal"
          },
          body: JSON.stringify(rows)
        }
      );
      if (!response.ok) throw await responseError(response, "写入 V85 数据失败");
    }

    async recordMigration(name, checksum, details) {
      const response = await fetch(
        `${this.url}/rest/v1/${MIGRATION_TABLE}?on_conflict=owner_id,migration_name`,
        {
          method: "POST",
          headers: {
            ...this.authHeaders(),
            Prefer: "resolution=merge-duplicates,return=minimal"
          },
          body: JSON.stringify([
            {
              owner_id: this.ownerId(),
              migration_name: name,
              checksum,
              details
            }
          ])
        }
      );
      if (!response.ok) throw await responseError(response, "记录迁移结果失败");
    }

    rememberEntities(rows) {
      rows.forEach((row) => {
        const key = `${row.bucket}:${row.entity_id}`;
        if (row.deleted_at) {
          this.knownEntityKeys.delete(key);
          this.entityDigests.delete(key);
        } else {
          this.knownEntityKeys.add(key);
          this.entityDigests.set(key, digest(row.data));
        }
        if (row.bucket === "history") {
          this.historyDigests.set(row.entity_id, digest(row.data?.prices || []));
        }
      });
    }

    deletedEntityRows(currentRows) {
      const currentKeys = new Set(currentRows.map((row) => `${row.bucket}:${row.entity_id}`));
      const deletedAt = new Date().toISOString();
      return [...this.knownEntityKeys]
        .filter((key) => !currentKeys.has(key))
        .map((key) => {
          const separator = key.indexOf(":");
          return {
            owner_id: this.ownerId(),
            bucket: key.slice(0, separator),
            entity_id: key.slice(separator + 1),
            data: {},
            source_version: SCHEMA_VERSION,
            deleted_at: deletedAt
          };
        });
    }
  }

  function entityRowsFromState(state, ownerId, includeHistory) {
    const rows = [];
    const prices = Array.isArray(state?.prices) ? state.prices : [];
    const stocks = Array.isArray(state?.stocks) ? state.stocks : [];
    stocks.forEach((stock) => {
      rows.push(entity(ownerId, "stock", stock.id, {
        ...stock,
        marketSummary: buildMarketSummary(stock, prices)
      }));
      if (includeHistory) {
        rows.push(
          entity(ownerId, "history", stock.id, {
            stockId: stock.id,
            market: stock.market,
            code: stock.code,
            prices: prices
              .filter((price) => price.stockId === stock.id)
              .sort((a, b) => String(a.date).localeCompare(String(b.date)))
              .slice(-60)
          })
        );
      }
    });
    addEntityRows(rows, ownerId, "plan", state?.plans);
    addEntityRows(rows, ownerId, "trade_log", state?.tradeLogs);
    addEntityRows(rows, ownerId, "report", state?.reports);
    addEntityRows(rows, ownerId, "snapshot", state?.snapshots);
    rows.push(entity(ownerId, "setting", "risk", state?.riskSettings || {}));
    (state?.deletedStocks || []).forEach((item) => {
      const identity = item.id || `${item.market || ""}-${item.code || ""}`;
      rows.push(entity(ownerId, "tombstone", identity, item));
    });
    rows.push(
      entity(ownerId, "dashboard", "primary", {
        generatedAt: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
        state: buildDashboardState(state, rows)
      })
    );
    return rows;
  }

  function stateFromEntityRows(rows) {
    const active = rows.filter((row) => !row.deleted_at);
    const stocks = active.filter((row) => row.bucket === "stock").map((row) => row.data);
    const dashboardState =
      active.find((row) => row.bucket === "dashboard" && row.entity_id === "primary")?.data?.state || {};
    const prices = stocks
      .map((stock) => stock.marketSummary?.latest)
      .filter(Boolean)
      .map((price) => ({ ...price }));
    return {
      stocks,
      prices,
      news: [],
      concepts: [],
      plans: bucketData(active, "plan"),
      tradeLogs: bucketData(active, "trade_log"),
      reports: bucketData(active, "report"),
      snapshots: bucketData(active, "snapshot"),
      riskSettings: active.find((row) => row.bucket === "setting" && row.entity_id === "risk")?.data || {},
      marketContext: dashboardState.marketContext || {},
      deletedStocks: bucketData(active, "tombstone"),
      syncMeta: {
        schemaVersion: SCHEMA_VERSION,
        source: "radar_entities",
        updatedAt: latestUpdatedAt(active)
      }
    };
  }

  function buildDashboardState(state, rows) {
    const stocks = rows.filter((row) => row.bucket === "stock").map((row) => row.data);
    const currentPlans = (state?.plans || []).filter((plan) => plan.date >= isoDate(new Date()));
    return {
      stocks,
      prices: stocks.map((stock) => stock.marketSummary?.latest).filter(Boolean),
      plans: currentPlans,
      tradeLogs: [],
      reports: [],
      snapshots: [],
      riskSettings: state?.riskSettings || {},
      marketContext: state?.marketContext || {},
      deletedStocks: state?.deletedStocks || [],
      news: [],
      concepts: [],
      syncMeta: {
        schemaVersion: SCHEMA_VERSION,
        source: "dashboard",
        updatedAt: new Date().toISOString()
      }
    };
  }

  function buildMarketSummary(stock, allPrices) {
    const prices = allPrices
      .filter((price) => price.stockId === stock.id && finite(price.close))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(-60);
    if (!prices.length) return null;
    const latest = prices.at(-1);
    const closes = prices.map((price) => Number(price.close));
    const latestDate = new Date(`${latest.date}T00:00:00`);
    const weekStart = new Date(latestDate);
    weekStart.setDate(latestDate.getDate() - ((latestDate.getDay() + 6) % 7));
    const monthStart = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);
    const weekBase = prices.find((price) => price.date >= isoDate(weekStart)) || prices.at(-1);
    const monthBase = prices.find((price) => price.date >= isoDate(monthStart)) || prices.at(-1);
    const addedBase = prices.find((price) => price.date >= stock.addedAt) || prices[0];
    return {
      latest: { ...latest },
      returns: {
        today: numberOrNull(latest.changePct),
        weekly: percentChange(latest.close, weekBase.close),
        monthly: percentChange(latest.close, monthBase.close),
        sinceAdded: percentChange(latest.close, addedBase.close)
      },
      high: Math.max(...closes),
      low: Math.min(...closes),
      sparkline: closes.slice(-20),
      historyCount: prices.length,
      risk: riskSummary(prices),
      strategyVersion: "v85.1"
    };
  }

  function riskSummary(prices) {
    if (prices.length < 5) {
      return { tone: "muted", label: "数据积累中", reason: `当前记录${prices.length}个交易日` };
    }
    const closes = prices.map((price) => Number(price.close));
    const returns = closes.slice(1).map((close, index) => percentChange(close, closes[index]) || 0);
    const recent = returns.slice(-10);
    const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const variance = recent.reduce((sum, value) => sum + (value - average) ** 2, 0) / recent.length;
    const volatility = Math.sqrt(variance);
    const fiveDayBase = closes[Math.max(0, closes.length - 6)];
    const trend = percentChange(closes.at(-1), fiveDayBase) || 0;
    const peak = Math.max(...closes);
    const drawdown = percentChange(closes.at(-1), peak) || 0;
    const latestChange = Number(prices.at(-1).changePct || 0);
    const detail = `近${recent.length}日波动${volatility.toFixed(2)}%/日，5日趋势${signed(trend)}%，阶段回撤${signed(drawdown)}%`;
    if (latestChange <= -5 && trend < 0) return { tone: "risk", label: "风险复核", reason: detail };
    if (latestChange >= 5 && volatility >= 3) return { tone: "caution", label: "暂缓追涨", reason: detail };
    if (trend >= 3 && volatility < 3) return { tone: "hold", label: "持有观察", reason: detail };
    return { tone: "watch", label: "观察", reason: detail };
  }

  function addEntityRows(target, ownerId, bucket, values) {
    (Array.isArray(values) ? values : []).forEach((item) => {
      const id = item.id || `${item.stockId || "entity"}-${item.date || digest(item)}`;
      target.push(entity(ownerId, bucket, String(id), item));
    });
  }

  function entity(ownerId, bucket, entityId, data) {
    return {
      owner_id: ownerId,
      bucket,
      entity_id: String(entityId),
      data,
      source_version: SCHEMA_VERSION,
      deleted_at: null
    };
  }

  function bucketData(rows, bucket) {
    return rows.filter((row) => row.bucket === bucket).map((row) => row.data);
  }

  function latestUpdatedAt(rows) {
    return rows.reduce(
      (latest, row) => (String(row.updated_at || "") > latest ? String(row.updated_at) : latest),
      ""
    );
  }

  function migrationCounts(state) {
    return {
      stocks: state?.stocks?.length || 0,
      prices: state?.prices?.length || 0,
      plans: state?.plans?.length || 0,
      reports: state?.reports?.length || 0,
      tradeLogs: state?.tradeLogs?.length || 0,
      snapshots: state?.snapshots?.length || 0,
      deletedStocks: state?.deletedStocks?.length || 0
    };
  }

  async function upsertInChunks(values, size, writer) {
    for (let index = 0; index < values.length; index += size) {
      await writer(values.slice(index, index + size));
    }
  }

  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function jwtPayload(token) {
    try {
      const payload = String(token || "").split(".")[1];
      return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    } catch {
      return {};
    }
  }

  function jwtSubject(token) {
    return jwtPayload(token).sub || "";
  }

  function jwtEmail(token) {
    return jwtPayload(token).email || "";
  }

  async function responseError(response, prefix) {
    const text = await response.text().catch(() => "");
    return new Error(`${prefix} ${response.status}${text ? `：${text.slice(0, 160)}` : ""}`);
  }

  function digest(value) {
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function finite(value) {
    return Number.isFinite(Number(value));
  }

  function numberOrNull(value) {
    return finite(value) ? Number(value) : null;
  }

  function percentChange(current, base) {
    const currentValue = Number(current);
    const baseValue = Number(base);
    if (!Number.isFinite(currentValue) || !Number.isFinite(baseValue) || baseValue === 0) return null;
    return Math.round(((currentValue / baseValue - 1) * 100) * 100) / 100;
  }

  function signed(value) {
    const number = Math.round(Number(value || 0) * 100) / 100;
    return `${number > 0 ? "+" : ""}${number.toFixed(2)}`;
  }

  function isoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  window.MarketRadarCloud = {
    create,
    schemaVersion: SCHEMA_VERSION,
    sessionKey: SESSION_KEY
  };
})();
