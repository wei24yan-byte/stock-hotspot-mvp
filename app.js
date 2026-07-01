const STORAGE_KEY = "stock-hotspot-mvp-v1";
const SUPABASE_CONFIG_KEY = "stock-hotspot-supabase-config-v1";
const SUPABASE_STATE_ROW_ID = "default";
const API_STATE_URL = "./api/state";
const STATIC_STATE_URL = "./data/state.json";
const AUTO_SYNC_DELAY_MS = 1000;
const AUTO_SYNC_RETRY_MS = 12000;

const newsTemplates = [
  "{name}盘中活跃，市场关注{concept}方向催化",
  "{name}跟随板块走强，资金继续聚焦{concept}",
  "{name}收盘表现受关注，相关新闻指向{concept}",
  "{name}所在产业链热度升温，{concept}成为今日关键词"
];

const sampleStocks = [
  { code: "300308", name: "中际旭创", market: "SZ", concepts: ["AI算力", "光模块"] },
  { code: "002594", name: "比亚迪", market: "SZ", concepts: ["新能源车", "电池"] },
  { code: "688981", name: "中芯国际", market: "SH", concepts: ["半导体", "国产替代"] },
  { code: "600519", name: "贵州茅台", market: "SH", concepts: ["白酒", "消费"] }
];

const els = {};
let state = emptyState();
let apiAvailable = false;
let stockLookupTimer = 0;
let stockLookupRequestId = 0;
let autoSyncTimer = 0;
let autoSyncInFlight = false;
let autoSyncPending = false;
let lastSupabaseError = "";
const CLIENT_ID = getClientId();

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  state = await loadState();
  setDefaultDates();
  bindEvents();
  render();
  registerServiceWorker();
});

function bindElements() {
  [
    "todayLabel",
    "refreshBtn",
    "stockCode",
    "stockName",
    "marketPreview",
    "stockConcepts",
    "addStockBtn",
    "sampleBtn",
    "stockTableBody",
    "stockEmpty",
    "conceptList",
    "newsList",
    "metricStocks",
    "metricDaily",
    "metricConcept",
    "metricNews",
    "stockCards",
    "buildReportsBtn",
    "copyReportBtn",
    "reportList",
    "supabaseUrl",
    "supabaseAnonKey",
    "saveSupabaseBtn",
    "pullSupabaseBtn",
    "supabaseStatus",
    "exportBtn",
    "importFile",
    "rebuildBtn",
    "clearBtn",
    "toast"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });

  els.addStockBtn.addEventListener("click", addStockFromForm);
  els.stockCode.addEventListener("input", handleStockCodeInput);
  els.stockCode.addEventListener("blur", () => refreshStockNameFromCode());
  els.refreshBtn.addEventListener("click", () => generateDailyUpdate());
  els.sampleBtn.addEventListener("click", seedSamples);
  els.buildReportsBtn.addEventListener("click", buildReports);
  els.copyReportBtn.addEventListener("click", copyLatestReport);
  els.saveSupabaseBtn.addEventListener("click", saveSupabaseConfig);
  els.pullSupabaseBtn.addEventListener("click", pullSupabaseState);
  els.exportBtn.addEventListener("click", exportData);
  els.importFile.addEventListener("change", importData);
  els.rebuildBtn.addEventListener("click", rebuildConcepts);
  els.clearBtn.addEventListener("click", clearData);
}

function emptyState() {
  return { stocks: [], prices: [], news: [], concepts: [], reports: [], deletedStocks: [], syncMeta: {} };
}

async function loadState() {
  const fallback = emptyState();
  loadSupabaseForm();
  const localState = loadLocalState();

  const cloudState = await loadSupabaseState();
  if (cloudState && localState) {
    const merged = mergeStates(localState, cloudState, { keepIncomingStocksOverPrimaryDeletes: true });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    if (!statesEqual(merged, cloudState)) setTimeout(() => queueSupabaseSync(300), 0);
    updateSupabaseStatus(`已合并本机与云端：${stateSummary(merged)}`);
    return merged;
  }
  if (cloudState) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudState));
    updateSupabaseStatus(`已读取云端：${stateSummary(cloudState)}`);
    return cloudState;
  }

  try {
    const response = await fetch(API_STATE_URL, { cache: "no-store" });
    if (response.ok) {
      apiAvailable = true;
      return normalizeState(await response.json());
    }
  } catch {
    apiAvailable = false;
  }

  try {
    const response = await fetch(`${STATIC_STATE_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (response.ok) {
      return normalizeState(await response.json());
    }
  } catch {
    // Static hosting may not have a seeded data file yet.
  }

  if (localState) return localState;
  return fallback;
}

function loadLocalState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeState(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

function saveState() {
  state = normalizeState(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  queueSupabaseSync();
  if (!apiAvailable) return;
  fetch(API_STATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state)
  }).catch(() => {
    apiAvailable = false;
    showToast("已切回本机存储");
  });
}

function queueSupabaseSync(delay = AUTO_SYNC_DELAY_MS) {
  if (!getSupabaseConfig()) {
    updateSupabaseStatus("未连接");
    return;
  }
  autoSyncPending = true;
  updateSupabaseStatus("待自动上传");
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(runQueuedSupabaseSync, delay);
}

function cancelQueuedSupabaseSync() {
  autoSyncPending = false;
  clearTimeout(autoSyncTimer);
}

function currentStateSnapshot() {
  return JSON.parse(JSON.stringify(normalizeState(state)));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSupabaseSave(snapshotFactory, forceStatus = false) {
  while (autoSyncInFlight) {
    await delay(250);
  }
  autoSyncInFlight = true;
  try {
    const snapshot = typeof snapshotFactory === "function" ? snapshotFactory() : snapshotFactory;
    return await saveSupabaseState(snapshot, forceStatus);
  } finally {
    autoSyncInFlight = false;
  }
}

async function runQueuedSupabaseSync() {
  if (!getSupabaseConfig()) {
    autoSyncPending = false;
    updateSupabaseStatus("未连接");
    return;
  }

  if (autoSyncInFlight) {
    autoSyncPending = true;
    clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(runQueuedSupabaseSync, AUTO_SYNC_DELAY_MS);
    return;
  }

  autoSyncPending = false;
  updateSupabaseStatus("自动上传中");

  const ok = await runSupabaseSave(currentStateSnapshot);

  if (autoSyncPending) {
    clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(runQueuedSupabaseSync, AUTO_SYNC_DELAY_MS);
    return;
  }

  if (ok) {
    updateSupabaseStatus(`已自动上传 ${formatClock(new Date())} · ${stateSummary(state)}`);
  } else {
    autoSyncPending = true;
    updateSupabaseStatus("自动上传失败，稍后重试");
    clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(runQueuedSupabaseSync, AUTO_SYNC_RETRY_MS);
  }
}

function getSupabaseConfig() {
  try {
    const config = JSON.parse(localStorage.getItem(SUPABASE_CONFIG_KEY) || "{}");
    const url = String(config.url || "").replace(/\/+$/, "");
    const anonKey = String(config.anonKey || "").trim();
    return url && anonKey ? { url, anonKey } : null;
  } catch {
    return null;
  }
}

function loadSupabaseForm() {
  const config = getSupabaseConfig();
  if (els.supabaseUrl) els.supabaseUrl.value = config?.url || "";
  if (els.supabaseAnonKey) els.supabaseAnonKey.value = config?.anonKey || "";
  updateSupabaseStatus(config ? "已配置" : "未连接");
}

function updateSupabaseStatus(text) {
  if (els.supabaseStatus) els.supabaseStatus.textContent = text;
}

function readSupabaseConfigFromForm() {
  const url = String(els.supabaseUrl.value || "").trim().replace(/\/+$/, "");
  const anonKey = String(els.supabaseAnonKey.value || "").trim();
  return url && anonKey ? { url, anonKey } : null;
}

function saveSupabaseConfigFromForm() {
  const config = readSupabaseConfigFromForm();
  if (!config) {
    showToast("请填写 URL 和 anon key");
    updateSupabaseStatus("未连接");
    return null;
  }
  localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(config));
  return config;
}

async function saveSupabaseConfig() {
  if (!saveSupabaseConfigFromForm()) return;
  cancelQueuedSupabaseSync();
  lastSupabaseError = "";
  updateSupabaseStatus(autoSyncInFlight ? "等待当前同步完成" : "上传中");
  els.saveSupabaseBtn.disabled = true;
  try {
    const ok = await runSupabaseSave(currentStateSnapshot, true);
    if (ok) {
      updateSupabaseStatus(`已同步并验证：${stateSummary(state)}`);
      showToast("云端同步已开启");
    } else {
      updateSupabaseStatus(`同步失败：${lastSupabaseError || "连接失败"}`);
      showToast(lastSupabaseError || "云端连接失败");
    }
  } finally {
    els.saveSupabaseBtn.disabled = false;
  }
}

async function pullSupabaseState() {
  if (!saveSupabaseConfigFromForm()) return;
  lastSupabaseError = "";
  updateSupabaseStatus("读取中");
  const cloudState = await loadSupabaseState(true);
  if (!cloudState) {
    updateSupabaseStatus(`读取失败：${lastSupabaseError || "云端暂无数据"}`);
    showToast(lastSupabaseError || "云端暂无数据或连接失败");
    return;
  }
  const localState = loadLocalState();
  state = localState ? mergeStates(localState, cloudState, { keepIncomingStocksOverPrimaryDeletes: true }) : normalizeState(cloudState);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  if (!statesEqual(state, cloudState)) queueSupabaseSync(300);
  updateSupabaseStatus(`已合并本机与云端：${stateSummary(state)}`);
  showToast("已合并本机与云端");
}

async function loadSupabaseState(showErrors = false, updateStatus = true, createIfMissing = true) {
  const config = getSupabaseConfig();
  if (!config) return null;
  try {
    const url = `${config.url}/rest/v1/app_state?id=eq.${encodeURIComponent(SUPABASE_STATE_ROW_ID)}&select=data`;
    const response = await fetch(url, { headers: supabaseHeaders(config), cache: "no-store" });
    if (!response.ok) throw new Error(await supabaseErrorMessage(response, "读取失败"));
    const rows = await response.json();
    const data = rows?.[0]?.data;
    if (!data) {
      if (!createIfMissing) return null;
      const created = await saveSupabaseState(emptyState());
      if (!created) return null;
      return emptyState();
    }
    if (updateStatus) updateSupabaseStatus("已同步");
    lastSupabaseError = "";
    return normalizeState(data);
  } catch (error) {
    if (showErrors) console.warn(error);
    lastSupabaseError = friendlySupabaseError(error);
    if (updateStatus) updateSupabaseStatus("云端不可用");
    return null;
  }
}

async function saveSupabaseState(nextState, forceStatus = false) {
  const config = getSupabaseConfig();
  if (!config) return false;
  try {
    const cloudBeforeWrite = await loadSupabaseState(false, false, false);
    const mergedBeforeWrite = cloudBeforeWrite ? mergeStates(nextState, cloudBeforeWrite) : normalizeState(nextState);
    const normalized = withSyncMeta(mergedBeforeWrite);
    const savedState = await writeSupabaseRow(config, normalized);
    state = normalizeState(savedState || normalized);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
    if (forceStatus) updateSupabaseStatus("已同步");
    lastSupabaseError = "";
    return true;
  } catch (error) {
    console.warn(error);
    lastSupabaseError = friendlySupabaseError(error);
    if (forceStatus) updateSupabaseStatus("同步失败");
    return false;
  }
}

async function writeSupabaseRow(config, normalized) {
  let rows = [];
  let response = await fetch(`${config.url}/rest/v1/app_state?id=eq.${encodeURIComponent(SUPABASE_STATE_ROW_ID)}`, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(config),
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({ data: normalized })
  });
  if (response.ok) {
    rows = await response.json().catch(() => []);
    if (!rows.length) {
      response = await fetch(`${config.url}/rest/v1/app_state`, {
        method: "POST",
        headers: {
          ...supabaseHeaders(config),
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({ id: SUPABASE_STATE_ROW_ID, data: normalized })
      });
      if (response.ok) rows = await response.json().catch(() => []);
    }
  }
  if (!response.ok) throw new Error(await supabaseErrorMessage(response, "写入失败"));
  const saved = rows?.[0]?.data ? normalizeState(rows[0].data) : normalized;
  if (!sameSyncDigest(saved, normalized) && !statesEqual(saved, normalized)) {
    throw new Error("写入后返回数据不一致");
  }
  return saved;
}

function supabaseHeaders(config) {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
    Accept: "application/json"
  };
}

async function supabaseErrorMessage(response, action) {
  const text = await response.text().catch(() => "");
  const detail = text.slice(0, 180).replace(/\s+/g, " ").trim();
  return `${action} ${response.status}${detail ? `：${detail}` : ""}`;
}

function friendlySupabaseError(error) {
  const message = String(error?.message || error || "连接失败");
  if (message.includes("401") || message.includes("403")) return "Key 或权限不对，请检查 anon key 和 RLS 策略";
  if (message.includes("404") || message.includes("app_state")) return "找不到 app_state 表，请重新运行 Supabase SQL";
  if (message.includes("Failed to fetch")) return "网络或 Supabase URL 不通";
  if (message.includes("JWT")) return "anon key 无效，请重新复制 Project API anon public key";
  return message.length > 80 ? `${message.slice(0, 80)}...` : message;
}

function normalizeState(value) {
  const legacyConcepts = Array.isArray(value?.concepts) ? value.concepts : [];
  const deletedStocks = Array.isArray(value?.deletedStocks) ? value.deletedStocks : [];
  const normalized = {
    stocks: Array.isArray(value?.stocks)
      ? value.stocks.map((stock) => normalizeStock(stock, legacyConcepts))
      : [],
    prices: Array.isArray(value?.prices) ? value.prices : [],
    news: Array.isArray(value?.news) ? value.news : [],
    concepts: legacyConcepts,
    reports: Array.isArray(value?.reports) ? value.reports : [],
    deletedStocks: deletedStocks.map(normalizeDeletedStock).filter((item) => item.id || item.code),
    syncMeta: value?.syncMeta && typeof value.syncMeta === "object" ? value.syncMeta : {}
  };
  return applyDeletedStocks(normalized);
}

function withSyncMeta(nextState) {
  const normalized = normalizeState(nextState);
  normalized.syncMeta = {
    digest: stableNumber(stableStringify(canonicalState(normalized))).toString(36),
    clientId: CLIENT_ID,
    updatedAt: new Date().toISOString()
  };
  return normalized;
}

function sameSyncDigest(a, b) {
  return Boolean(a?.syncMeta?.digest && b?.syncMeta?.digest && a.syncMeta.digest === b.syncMeta.digest);
}

function normalizeStock(stock, legacyConcepts = []) {
  const stockId = stock?.id || makeId();
  const migratedConcepts = legacyConcepts
    .filter((item) => item.stockId === stockId)
    .map((item) => item.tag);
  const concepts = normalizeConceptList(
    stock?.concepts && stock.concepts.length ? stock.concepts : migratedConcepts
  );

  return {
    id: stockId,
    code: cleanCode(stock?.code || ""),
    name: String(stock?.name || "").trim(),
    market: inferMarket(stock?.code || "") || stock?.market || "SH",
    addedAt: stock?.addedAt || stock?.added_at || formatDate(new Date()),
    active: stock?.active !== false,
    pinned: stock?.pinned === true,
    concepts
  };
}

function normalizeDeletedStock(item) {
  return {
    id: String(item?.id || ""),
    code: cleanCode(item?.code || ""),
    market: item?.market || inferMarket(item?.code || ""),
    deletedAt: item?.deletedAt || formatDate(new Date())
  };
}

function mergeStates(primary, secondary, options = {}) {
  const base = normalizeState(primary);
  const incoming = normalizeState(secondary);
  const incomingStockKeys = new Set(incoming.stocks.flatMap((stock) => [stock.id, `${stock.market}-${stock.code}`]));
  const primaryDeletedStocks = options.keepIncomingStocksOverPrimaryDeletes
    ? base.deletedStocks.filter((item) => !stockDeleteKeys(item).some((key) => incomingStockKeys.has(key)))
    : base.deletedStocks;
  const deletedStocks = dedupeBy(
    [...primaryDeletedStocks, ...incoming.deletedStocks],
    (item) => `${item.id || ""}|${item.market || ""}|${item.code || ""}`
  );
  const deletedKeys = new Set(deletedStocks.flatMap((item) => stockDeleteKeys(item)));
  const idMap = new Map();
  const stocks = [];

  [...base.stocks, ...incoming.stocks].forEach((stock) => {
    const key = `${stock.market}-${stock.code}`;
    if (deletedKeys.has(stock.id) || deletedKeys.has(key)) return;
    const existing = stocks.find((item) => item.market === stock.market && item.code === stock.code);
    if (!existing) {
      stocks.push({ ...stock, concepts: normalizeConceptList(stock.concepts) });
      return;
    }
    idMap.set(stock.id, existing.id);
    existing.name = existing.name || stock.name;
    existing.addedAt = existing.addedAt <= stock.addedAt ? existing.addedAt : stock.addedAt;
    existing.active = existing.active !== false && stock.active !== false;
    existing.pinned = existing.pinned === true || stock.pinned === true;
    existing.concepts = normalizeConceptList([...(existing.concepts || []), ...(stock.concepts || [])]);
  });

  const prices = dedupeBy(
    [...base.prices, ...incoming.prices].map((price) => remapStockRef(price, idMap)),
    (price) => `${price.stockId}-${price.date}`
  );
  const news = dedupeBy(
    [...base.news, ...incoming.news].map((item) => remapStockRef(item, idMap)),
    (item) => `${item.stockId}-${item.date}-${item.title}`
  );
  const reports = dedupeBy([...base.reports, ...incoming.reports], (item) => item.id || `${item.type}-${item.date}`);
  const merged = { stocks, prices, news, concepts: [], reports, deletedStocks };
  syncConceptSnapshotForState(merged);
  return applyDeletedStocks(merged);
}

function remapStockRef(item, idMap) {
  const next = { ...item };
  if (idMap.has(next.stockId)) next.stockId = idMap.get(next.stockId);
  return next;
}

function applyDeletedStocks(nextState) {
  const deletedKeys = new Set((nextState.deletedStocks || []).flatMap((item) => stockDeleteKeys(item)));
  const stocks = (nextState.stocks || []).filter((stock) => {
    const key = `${stock.market}-${stock.code}`;
    return !deletedKeys.has(stock.id) && !deletedKeys.has(key);
  });
  const stockIds = new Set(stocks.map((stock) => stock.id));
  return {
    ...nextState,
    stocks,
    prices: (nextState.prices || []).filter((price) => stockIds.has(price.stockId)),
    news: (nextState.news || []).filter((item) => stockIds.has(item.stockId)),
    concepts: (nextState.concepts || []).filter((item) => stockIds.has(item.stockId))
  };
}

function stockDeleteKeys(item) {
  const keys = [];
  if (item?.id) keys.push(item.id);
  if (item?.code && item?.market) keys.push(`${item.market}-${item.code}`);
  return keys;
}

function dedupeBy(items, keyFn) {
  const map = new Map();
  items.filter(Boolean).forEach((item) => {
    const key = keyFn(item);
    if (!key || map.has(key)) return;
    map.set(key, item);
  });
  return [...map.values()];
}

function statesEqual(a, b) {
  return stableStringify(canonicalState(a)) === stableStringify(canonicalState(b));
}

function canonicalState(value) {
  const data = normalizeState(value);
  const stockKey = (stock) => `${stock.market || ""}-${stock.code || ""}`;
  const stockById = new Map(data.stocks.map((stock) => [stock.id, stockKey(stock)]));

  return {
    stocks: [...data.stocks]
      .map((stock) => ({
        key: stockKey(stock),
        code: stock.code,
        market: stock.market,
        name: stock.name,
        active: stock.active !== false,
        pinned: stock.pinned === true,
        concepts: normalizeConceptList(stock.concepts).sort((a, b) => a.localeCompare(b))
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    prices: [...data.prices]
      .map((price) => ({
        key: `${stockById.get(price.stockId) || price.stockId}-${price.date}`,
        stock: stockById.get(price.stockId) || price.stockId,
        date: price.date,
        close: Number.isFinite(Number(price.close)) ? Number(price.close).toFixed(4) : "",
        changePct: Number.isFinite(Number(price.changePct)) ? Number(price.changePct).toFixed(4) : ""
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    news: [...data.news]
      .map((item) => ({
        key: `${stockById.get(item.stockId) || item.stockId}-${item.date}-${item.title}`,
        stock: stockById.get(item.stockId) || item.stockId,
        date: item.date,
        title: item.title
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    reports: [...data.reports]
      .map((item) => ({
        key: item.id || `${item.type}-${item.date}`,
        type: item.type || "",
        date: item.date || ""
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    deletedStocks: [...(data.deletedStocks || [])]
      .map((item) => ({
        key: `${item.id || ""}|${item.market || ""}|${item.code || ""}`,
        id: item.id || "",
        code: item.code || "",
        market: item.market || ""
      }))
      .sort((a, b) => a.key.localeCompare(b.key))
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function getClientId() {
  const key = "stock-hotspot-client-id-v1";
  try {
    const saved = localStorage.getItem(key);
    if (saved) return saved;
    const next = makeId();
    localStorage.setItem(key, next);
    return next;
  } catch {
    return makeId();
  }
}

function setDefaultDates() {
  const today = formatDate(new Date());
  els.todayLabel.textContent = today;
  updateMarketPreview();
}

function setView(viewName) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `${viewName}View`);
  });
}

async function addStockFromForm() {
  const code = cleanCode(els.stockCode.value);
  const market = inferMarket(code);
  const concepts = parseConceptInput(els.stockConcepts.value);

  if (!code) {
    showToast("请输入股票代码");
    return;
  }

  if (!market) {
    showToast("无法识别市场，请检查股票代码");
    return;
  }

  if (state.stocks.some((stock) => stock.code === code && stock.market === market)) {
    showToast("股票已存在");
    return;
  }

  els.addStockBtn.disabled = true;
  let name = els.stockName.value.trim();
  if (!name) {
    showToast("正在识别股票名称");
    const quote = await fetchStockQuote(code, market).catch(() => null);
    name = quote?.name || lookupStockNameFallback(code, market);
    if (name) els.stockName.value = name;
  }

  if (!name) {
    els.addStockBtn.disabled = false;
    showToast("名称识别失败，请检查代码");
    return;
  }

  state.stocks.unshift({
    id: makeId(),
    code,
    name,
    market,
    concepts,
    addedAt: formatDate(new Date()),
    active: true,
    pinned: false
  });

  els.stockCode.value = "";
  els.stockName.value = "";
  els.stockConcepts.value = "";
  updateMarketPreview();
  syncConceptSnapshot();
  saveState();
  render();
  els.addStockBtn.disabled = false;
  showToast("已添加");
}

async function seedSamples() {
  let count = 0;
  sampleStocks.forEach((item) => {
    const exists = state.stocks.some((stock) => stock.code === item.code && stock.market === item.market);
    if (!exists) {
      state.stocks.push({
        id: makeId(),
        code: item.code,
        name: item.name,
        market: item.market,
        concepts: normalizeConceptList(item.concepts),
        addedAt: formatDate(new Date()),
        active: true,
        pinned: false
      });
      count += 1;
    }
  });
  saveState();
  await generateDailyUpdate(false);
  showToast(count ? "样例已载入" : "样例已存在");
}

async function generateDailyUpdate(showMessage = true) {
  if (!state.stocks.length) {
    showToast("暂无股票");
    return;
  }

  const activeStocks = state.stocks.filter((stock) => stock.active);
  let updated = 0;
  let failed = 0;
  els.refreshBtn.disabled = true;

  for (const stock of activeStocks) {
    const quote = await fetchStockQuote(stock.code, stock.market).catch(() => null);
    if (!quote?.close || quote.changePct === null) {
      failed += 1;
      continue;
    }

    if (quote.name && quote.name !== stock.name) stock.name = quote.name;
    upsertPrice({
      stockId: stock.id,
      date: quote.date || formatDate(new Date()),
      close: round(quote.close, 2),
      changePct: round(quote.changePct, 2)
    });

    const concept = primaryConcept(stock) || "未填写概念";
    const title = buildNewsTitle(stock, concept, quote.date || formatDate(new Date()));
    upsertNews({
      stockId: stock.id,
      date: quote.date || formatDate(new Date()),
      title,
      source: "自用聚合",
      url: `https://www.baidu.com/s?wd=${encodeURIComponent(`${stock.name} ${concept}`)}`,
      summary: `${stock.name} 今日关联 ${concept}，需结合公告、板块表现和成交额进一步确认。`
    });
    updated += 1;
  }

  els.refreshBtn.disabled = false;

  if (!updated) {
    showToast("行情读取失败，未更新");
    return;
  }

  syncConceptSnapshot();
  buildReports(false);
  saveState();
  render();
  if (showMessage) {
    showToast(failed ? `已更新${updated}只，${failed}只未取到` : "真实行情已更新");
  }
}

function upsertPrice(price) {
  const existing = state.prices.find((item) => item.stockId === price.stockId && item.date === price.date);
  if (existing) {
    Object.assign(existing, price);
  } else {
    state.prices.push({ id: makeId(), ...price });
  }
}

function upsertNews(news) {
  const existing = state.news.find((item) => item.stockId === news.stockId && item.date === news.date && item.title === news.title);
  if (!existing) state.news.push({ id: makeId(), ...news });
}

function rebuildConcepts(showMessage = true) {
  syncConceptSnapshot();
  saveState();
  render();
  if (showMessage) showToast("概念已同步");
}

function syncConceptSnapshot() {
  syncConceptSnapshotForState(state);
}

function syncConceptSnapshotForState(nextState) {
  const today = formatDate(new Date());
  nextState.concepts = nextState.stocks.flatMap((stock) =>
    normalizeConceptList(stock.concepts).map((tag, index) => ({
      id: `${stock.id}-${tag}`,
      stockId: stock.id,
      date: today,
      tag,
      reason: "手动输入",
      score: 100 - index
    }))
  );
}

function buildReports(showMessage = true) {
  const today = formatDate(new Date());
  const reports = [
    {
      id: `daily-${today}`,
      type: "日报",
      date: today,
      content: buildReportContent("日报", today, "daily")
    },
    {
      id: `weekly-${weekKey(new Date())}`,
      type: "周报",
      date: today,
      content: buildReportContent("周报", today, "weekly")
    },
    {
      id: `monthly-${today.slice(0, 7)}`,
      type: "月报",
      date: today,
      content: buildReportContent("月报", today, "monthly")
    }
  ];

  reports.forEach((report) => {
    const existingIndex = state.reports.findIndex((item) => item.id === report.id);
    if (existingIndex >= 0) state.reports[existingIndex] = report;
    else state.reports.push(report);
  });

  saveState();
  render();
  if (showMessage) showToast("报告已生成");
}

function buildReportContent(title, date, period) {
  const lines = [`${date} ${title}`, ""];
  const rows = state.stocks
    .map((stock) => {
      const latest = latestPrice(stock.id);
      return {
        stock,
        latest,
        ret: period === "daily" ? latest?.changePct : periodReturn(stock.id, period)
      };
    })
    .filter((row) => row.latest)
    .sort((a, b) => Number(b.ret || 0) - Number(a.ret || 0));

  if (!rows.length) return `${date} ${title}\n\n暂无行情记录`;

  rows.forEach((row, index) => {
    const tags = conceptsForStock(row.stock.id).join("、") || "暂无概念";
    lines.push(`${index + 1}. ${row.stock.name} ${formatPct(row.ret)}，最新价 ${formatNumber(row.latest.close)}，概念：${tags}`);
  });

  const hot = topConcepts()[0];
  if (hot) {
    lines.push("");
    lines.push(`热点聚合：${hot.tag} 关联 ${hot.count} 次`);
  }

  return lines.join("\n");
}

function render() {
  renderMetrics();
  renderStockTable();
  renderConcepts();
  renderNews();
  renderStockCards();
  renderReports();
}

function renderMetrics() {
  const activeStocks = state.stocks.filter((stock) => stock.active);
  const today = formatDate(new Date());
  const todayPrices = state.prices.filter((price) => price.date === today);
  const avg = todayPrices.length
    ? todayPrices.reduce((sum, item) => sum + Number(item.changePct), 0) / todayPrices.length
    : null;
  const hot = topConcepts()[0];

  els.metricStocks.textContent = activeStocks.length;
  els.metricDaily.textContent = avg === null ? "-" : formatPct(avg);
  els.metricDaily.className = avg === null ? "" : avg >= 0 ? "positive" : "negative";
  els.metricConcept.textContent = hot ? hot.tag : "-";
  els.metricNews.textContent = state.news.length;
}

function renderStockTable() {
  els.stockTableBody.innerHTML = "";
  els.stockEmpty.classList.toggle("show", state.stocks.length === 0);

  orderedStocks().forEach((stock) => {
    const latest = latestPrice(stock.id);
    const row = document.createElement("tr");
    const tags = conceptsForStock(stock.id).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
    row.innerHTML = `
      <td data-label="股票">
        <div class="stock-title">
          <button class="pin-button ${stock.pinned ? "active" : ""}" data-action="pin" data-stock-id="${stock.id}" title="${stock.pinned ? "取消置顶" : "置顶"}" aria-label="${stock.pinned ? "取消置顶" : "置顶"}">${stock.pinned ? "★" : "☆"}</button>
          <strong>${escapeHtml(stock.name)}</strong>
          <span>${stock.market}${stock.code}</span>
        </div>
      </td>
      <td data-label="添加日">${stock.addedAt}</td>
      <td data-label="最新价">${latest ? formatNumber(latest.close) : '<span class="muted">-</span>'}</td>
      <td data-label="添加以来">${pctHtml(sinceAddedReturn(stock.id, stock.addedAt))}</td>
      <td data-label="今日">${latest ? pctHtml(latest.changePct) : '<span class="muted">-</span>'}</td>
      <td data-label="周">${pctHtml(periodReturn(stock.id, "weekly"))}</td>
      <td data-label="月">${pctHtml(periodReturn(stock.id, "monthly"))}</td>
      <td data-label="概念"><div class="tag-row">${tags || '<span class="muted">-</span>'}</div></td>
    `;
    els.stockTableBody.appendChild(row);
  });

  els.stockTableBody.querySelectorAll("[data-action='pin']").forEach((button) => {
    button.addEventListener("click", () => togglePinnedStock(button.dataset.stockId));
  });
}

function renderConcepts() {
  const items = topConcepts();
  els.conceptList.innerHTML = items.length
    ? items.map((item, index) => `<span class="tag ${index === 0 ? "amber" : ""}">${escapeHtml(item.tag)} · ${item.count}</span>`).join("")
    : `<span class="muted">暂无概念</span>`;
}

function renderNews() {
  const news = [...state.news]
    .sort((a, b) => `${b.date}${b.id}`.localeCompare(`${a.date}${a.id}`))
    .slice(0, 8);

  els.newsList.innerHTML = news.length
    ? news
        .map((item) => {
          const stock = state.stocks.find((entry) => entry.id === item.stockId);
          const concepts = conceptsForStock(item.stockId)
            .slice(0, 2)
            .map((concept) => `<span>${escapeHtml(concept)}</span>`)
            .join("");
          return `
            <article class="news-item">
              <a href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>
              <div class="news-meta">
                <span>${escapeHtml(stock?.name || "未知股票")}</span>
                <span>${item.date}</span>
                <span>${escapeHtml(item.source)}</span>
                ${concepts}
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="muted">暂无新闻</div>`;
}

function renderStockCards() {
  els.stockCards.innerHTML = state.stocks.length
    ? orderedStocks()
        .map((stock) => {
          const latest = latestPrice(stock.id);
          const concepts = conceptsForStock(stock.id)
            .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
            .join("");
          const conceptValue = conceptsForStock(stock.id).join("、");
          return `
            <article class="stock-card">
              <div class="stock-card-head">
                <div class="stock-title">
                  <strong>${escapeHtml(stock.name)}</strong>
                  <span>${stock.market}${stock.code} · ${stock.addedAt}</span>
                </div>
                <div class="stock-actions">
                  <button class="ghost-button" data-action="toggle" data-stock-id="${stock.id}">${stock.active ? "停用" : "启用"}</button>
                  <button class="ghost-button" data-action="pin" data-stock-id="${stock.id}">${stock.pinned ? "取消置顶" : "置顶"}</button>
                  <button class="danger-button" data-action="delete" data-stock-id="${stock.id}">删除</button>
                </div>
              </div>
              <div class="mini-stats">
                <div class="mini-stat"><span>最新价</span><strong>${latest ? formatNumber(latest.close) : "-"}</strong></div>
                <div class="mini-stat"><span>今日</span><strong>${latest ? formatPct(latest.changePct) : "-"}</strong></div>
                <div class="mini-stat"><span>添加以来</span><strong>${formatPct(sinceAddedReturn(stock.id, stock.addedAt))}</strong></div>
              </div>
              <div class="tag-row">${concepts || '<span class="muted">暂无概念</span>'}</div>
              <div class="concept-editor">
                <label>
                  <span>手动概念</span>
                  <input data-concept-input="${stock.id}" value="${escapeAttr(conceptValue)}" placeholder="AI算力、机器人、低空经济" />
                </label>
                <button class="ghost-button" data-action="save-concepts" data-stock-id="${stock.id}">保存概念</button>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="muted">暂无股票</div>`;

  els.stockCards.querySelectorAll("[data-action='toggle']").forEach((button) => {
    button.addEventListener("click", () => {
      const stock = state.stocks.find((item) => item.id === button.dataset.stockId);
      if (!stock) return;
      stock.active = !stock.active;
      saveState();
      render();
      showToast(stock.active ? "已启用" : "已停用");
    });
  });

  els.stockCards.querySelectorAll("[data-action='pin']").forEach((button) => {
    button.addEventListener("click", () => togglePinnedStock(button.dataset.stockId));
  });

  els.stockCards.querySelectorAll("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", () => {
      const stock = state.stocks.find((item) => item.id === button.dataset.stockId);
      if (!stock) return;
      if (!confirm(`确认删除 ${stock.name} 吗？相关行情、新闻和概念记录也会一起删除。`)) return;
      deleteStock(stock.id);
      showToast("已删除");
    });
  });

  els.stockCards.querySelectorAll("[data-action='save-concepts']").forEach((button) => {
    button.addEventListener("click", () => {
      const stock = state.stocks.find((item) => item.id === button.dataset.stockId);
      const input = els.stockCards.querySelector(`[data-concept-input="${button.dataset.stockId}"]`);
      if (!stock || !input) return;
      stock.concepts = parseConceptInput(input.value);
      syncConceptSnapshot();
      buildReports(false);
      saveState();
      render();
      showToast("概念已保存");
    });
  });
}

function orderedStocks() {
  return [...state.stocks].sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true));
}

function togglePinnedStock(stockId) {
  const stock = state.stocks.find((item) => item.id === stockId);
  if (!stock) return;
  stock.pinned = stock.pinned !== true;
  saveState();
  render();
  showToast(stock.pinned ? "已置顶" : "已取消置顶");
}

function deleteStock(stockId) {
  const stock = state.stocks.find((item) => item.id === stockId);
  if (stock) {
    state.deletedStocks = dedupeBy(
      [
        ...(state.deletedStocks || []),
        {
          id: stock.id,
          code: stock.code,
          market: stock.market,
          deletedAt: formatDate(new Date())
        }
      ],
      (item) => `${item.id || ""}|${item.market || ""}|${item.code || ""}`
    );
  }
  state.stocks = state.stocks.filter((stock) => stock.id !== stockId);
  state.prices = state.prices.filter((price) => price.stockId !== stockId);
  state.news = state.news.filter((news) => news.stockId !== stockId);
  state.concepts = state.concepts.filter((concept) => concept.stockId !== stockId);
  syncConceptSnapshot();
  buildReports(false);
  saveState();
  render();
}

function renderReports() {
  const reports = [...state.reports].sort((a, b) => `${b.date}${b.type}`.localeCompare(`${a.date}${a.type}`));
  els.reportList.innerHTML = reports.length
    ? reports
        .map(
          (report) => `
            <article class="report-card">
              <h3>${escapeHtml(report.type)} · ${report.date}</h3>
              <pre>${escapeHtml(report.content)}</pre>
            </article>
          `
        )
        .join("")
    : `<div class="panel"><div class="muted">暂无报告</div></div>`;
}

function latestPrice(stockId) {
  return state.prices
    .filter((price) => price.stockId === stockId)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

function priceRange(stockId, period) {
  const now = new Date();
  const start = new Date(now);
  if (period === "weekly") start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  if (period === "monthly") start.setDate(1);
  const startText = formatDate(start);
  return state.prices
    .filter((price) => price.stockId === stockId && price.date >= startText)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function periodReturn(stockId, period) {
  const range = priceRange(stockId, period);
  if (range.length < 2) return null;
  const first = range[0].close;
  const last = range[range.length - 1].close;
  return round(((last - first) / first) * 100, 2);
}

function sinceAddedReturn(stockId, addedAt) {
  const prices = state.prices
    .filter((price) => price.stockId === stockId && price.date >= addedAt)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (prices.length < 2) return null;
  return round(((prices.at(-1).close - prices[0].close) / prices[0].close) * 100, 2);
}

function latestConcepts(stockId) {
  return conceptsForStock(stockId).map((tag, index) => ({
    tag,
    reason: "手动输入",
    score: 100 - index
  }));
}

function topConcepts() {
  const counts = new Map();
  state.stocks.filter((stock) => stock.active).forEach((stock) => {
    conceptsForStock(stock.id).forEach((tag) => {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 8);
}

function conceptsForStock(stockOrId) {
  const stock = typeof stockOrId === "string"
    ? state.stocks.find((item) => item.id === stockOrId)
    : stockOrId;
  return normalizeConceptList(stock?.concepts);
}

function primaryConcept(stock) {
  return conceptsForStock(stock)[0] || "";
}

function parseConceptInput(value) {
  return normalizeConceptList(String(value || "").split(/[、,，;；\n\r\t ]+/));
}

function normalizeConceptList(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[、,，;；\n\r\t ]+/);
  const seen = new Set();
  return source
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function buildNewsTitle(stock, concept, date) {
  const template = newsTemplates[stableNumber(`${stock.code}-${date}-news`, newsTemplates.length)];
  return template.replace("{name}", stock.name).replace("{concept}", concept);
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `stock-hotspot-${formatDate(new Date())}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    state = {
      stocks: Array.isArray(imported.stocks)
        ? imported.stocks.map((stock) => normalizeStock(stock, imported.concepts))
        : [],
      prices: Array.isArray(imported.prices) ? imported.prices : [],
      news: Array.isArray(imported.news) ? imported.news : [],
      concepts: Array.isArray(imported.concepts) ? imported.concepts : [],
      reports: Array.isArray(imported.reports) ? imported.reports : []
    };
    syncConceptSnapshot();
    saveState();
    render();
    showToast("导入完成");
  } catch {
    showToast("导入失败");
  } finally {
    event.target.value = "";
  }
}

function clearData() {
  if (!confirm("确认清空本机数据？")) return;
  state = { stocks: [], prices: [], news: [], concepts: [], reports: [] };
  saveState();
  render();
  showToast("已清空");
}

async function copyLatestReport() {
  const latest = [...state.reports].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!latest) {
    showToast("暂无报告");
    return;
  }
  await navigator.clipboard.writeText(latest.content);
  showToast("报告已复制");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
}

function cleanCode(value) {
  return value.trim().replace(/[^\d]/g, "").slice(0, 6);
}

function inferMarket(value) {
  const code = cleanCode(value);
  if (code.length !== 6) return "";
  if (/^(600|601|603|605|688|689|900)/.test(code)) return "SH";
  if (/^(000|001|002|003|200|300|301)/.test(code)) return "SZ";
  if (/^(430|830|831|832|833|834|835|836|837|838|839|870|871|872|873|874|875|876|877|878|879|880|881|882|883|884|885|886|887|888|889|920)/.test(code)) return "BJ";
  if (code.startsWith("6")) return "SH";
  if (/^[023]/.test(code)) return "SZ";
  if (/^[48]/.test(code)) return "BJ";
  return "";
}

function marketName(market) {
  return { SH: "沪市", SZ: "深市", BJ: "北交所" }[market] || "未识别";
}

function updateMarketPreview() {
  if (!els.marketPreview) return;
  const code = cleanCode(els.stockCode.value);
  const market = inferMarket(code);
  els.marketPreview.textContent = market ? `${marketName(market)} · ${market}${code}` : "输入代码后识别";
  els.marketPreview.classList.toggle("muted", !market);
}

function handleStockCodeInput() {
  updateMarketPreview();
  clearTimeout(stockLookupTimer);

  const code = cleanCode(els.stockCode.value);
  const market = inferMarket(code);
  if (!code || code.length < 6 || !market) {
    els.stockName.value = "";
    els.stockName.placeholder = "输入代码后自动显示";
    return;
  }

  els.stockName.value = lookupStockNameFallback(code, market) || "";
  els.stockName.placeholder = "正在识别...";
  stockLookupTimer = setTimeout(() => refreshStockNameFromCode(), 280);
}

async function refreshStockNameFromCode() {
  const code = cleanCode(els.stockCode.value);
  const market = inferMarket(code);
  if (code.length !== 6 || !market) return;

  const requestId = ++stockLookupRequestId;
  const quote = await fetchStockQuote(code, market).catch(() => null);
  if (requestId !== stockLookupRequestId || cleanCode(els.stockCode.value) !== code) return;

  const name = quote?.name || lookupStockNameFallback(code, market);
  if (name) {
    els.stockName.value = name;
    els.stockName.placeholder = "输入代码后自动显示";
    els.marketPreview.textContent = `${marketName(market)} · ${market}${code} · ${name}`;
  } else {
    els.stockName.value = "";
    els.stockName.placeholder = "未识别，请检查代码";
  }
}

function lookupStockNameFallback(code, market) {
  const existing = state.stocks.find((stock) => stock.code === code && stock.market === market);
  if (existing?.name) return existing.name;
  const sample = sampleStocks.find((stock) => stock.code === code && stock.market === market);
  return sample?.name || "";
}

function fetchStockQuote(codeValue, marketValue) {
  const code = cleanCode(codeValue);
  const market = marketValue || inferMarket(code);
  if (code.length !== 6 || !market) return Promise.reject(new Error("Invalid stock code"));

  const symbol = `${market.toLowerCase()}${code}`;
  const varName = `v_${symbol}`;

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;

    const cleanup = () => {
      script.remove();
      clearTimeout(timer);
      try {
        delete globalThis[varName];
      } catch {
        globalThis[varName] = undefined;
      }
    };

    const done = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    const timer = setTimeout(() => done(reject, new Error("Quote timeout")), 8000);
    globalThis[varName] = undefined;
    script.charset = "gbk";
    script.src = `https://qt.gtimg.cn/q=${symbol}&_=${Date.now()}`;
    script.onload = () => {
      const quote = parseTencentQuote(globalThis[varName], code, market);
      if (quote) done(resolve, quote);
      else done(reject, new Error("Quote empty"));
    };
    script.onerror = () => done(reject, new Error("Quote network error"));
    document.head.appendChild(script);
  });
}

function parseTencentQuote(raw, code, market) {
  const parts = String(raw || "").split("~");
  const name = String(parts[1] || "").trim();
  const close = numberOrNull(parts[3]);
  const previousClose = numberOrNull(parts[4]);
  const changePct = numberOrNull(parts[32]) ??
    (close !== null && previousClose ? round(((close - previousClose) / previousClose) * 100, 2) : null);

  if (!name && close === null) return null;
  return {
    code,
    market,
    name,
    close,
    previousClose,
    changePct,
    date: parseQuoteDate(parts[30]) || formatDate(new Date())
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseQuoteDate(value) {
  const text = String(value || "");
  if (!/^\d{8}/.test(text)) return "";
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function formatClock(date) {
  return date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

function stateSummary(value) {
  const data = normalizeState(value);
  return `股票${data.stocks.length} 行情${data.prices.length} 新闻${data.news.length}`;
}

function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekKey(date) {
  const d = new Date(date);
  const first = new Date(d);
  first.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return formatDate(first);
}

function formatNumber(value) {
  return Number(value).toFixed(2);
}

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const num = Number(value);
  return `${num > 0 ? "+" : ""}${num.toFixed(2)}%`;
}

function pctHtml(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '<span class="muted">-</span>';
  return `<span class="${Number(value) >= 0 ? "positive" : "negative"}">${formatPct(value)}</span>`;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stableNumber(text, modulo) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return modulo ? hash % modulo : hash;
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 1800);
}
