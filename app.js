const STORAGE_KEY = "stock-hotspot-mvp-v1";
const SUPABASE_CONFIG_KEY = "stock-hotspot-supabase-config-v1";
const SUPABASE_STATE_ROW_ID = "default";
const API_STATE_URL = "./api/state";
const STATIC_STATE_URL = "./data/state.json";
const CLOUD_RESTORE_BACKUP_KEY = "stock-hotspot-backup-before-cloud-v1";
const AUTO_SYNC_DELAY_MS = 1000;
const AUTO_SYNC_RETRY_MS = 12000;
const STOCK_LOOKUP_DELAY_MS = 280;
const MARKET_HOLIDAYS = new Set([]);
const LEGACY_CREATED_AT_FALLBACK = "1970-01-01T00:00:00.000Z";
const STOCK_STATUS_OPTIONS = [
  ["watch", "观察中"],
  ["planned", "明日计划"],
  ["holding", "已持仓"],
  ["closed", "已结束"]
];
const STRATEGY_OPTIONS = [
  ["", "未设置"],
  ["breakout", "突破确认"],
  ["breakout_retest", "突破回踩"],
  ["trend_pullback", "趋势回踩"],
  ["support_rebound", "支撑反弹"],
  ["rebound", "超跌反弹"],
  ["event", "事件驱动"],
  ["custom", "自定义"]
];
const ENTRY_LOGIC_OPTIONS = [
  ["", "未设置"],
  ["breakout_volume", "突破且放量"],
  ["breakout_retest", "突破后回踩企稳"],
  ["ma_support", "均线回踩企稳"],
  ["structure_support", "结构支撑止跌"],
  ["reversal_confirm", "反转形态确认"],
  ["event_confirm", "事件催化确认"],
  ["manual", "手动确认"]
];
const NO_TRADE_CONDITION_OPTIONS = [
  ["above_entry", "价格超过买入上限"],
  ["below_invalidation", "买入前跌破失效价"],
  ["volume_unconfirmed", "成交量未确认"],
  ["sector_weak", "板块或概念转弱"],
  ["market_weak", "大盘环境不符合"],
  ["rr_low", "盈亏比不足 1.5R"],
  ["volatility_abnormal", "当日波动异常扩大"],
  ["data_stale", "行情过期或数据不足"],
  ["position_limit", "计划总仓位超限"],
  ["event_unconfirmed", "事件催化未确认"]
];
const EXIT_LOGIC_OPTIONS = [
  ["invalidation", "策略失效退出"],
  ["targets", "目标分批止盈"],
  ["trailing", "移动保护退出"],
  ["time", "时间退出"],
  ["context", "板块或事件退出"],
  ["manual", "手动复核"]
];
const EXIT_CONDITION_OPTIONS = [
  ["invalidation", "触发策略失效价"],
  ["target1", "达到第一目标价"],
  ["target2", "达到第二目标价"],
  ["previous_low", "跌破前一交易日低点"],
  ["ma5", "跌破5日线"],
  ["ma10", "跌破10日线"],
  ["structure_low", "跌破近期结构低点"],
  ["breakeven", "回落至成本价保护"],
  ["sector_weak", "板块或热点退潮"],
  ["event_failed", "催化落空或不及预期"],
  ["max_days", "达到最长持有天数"],
  ["market_risk", "大盘风险触发"]
];
const DEFAULT_RISK_SETTINGS = {
  riskPerTradePct: 0.5,
  maxPositionPct: 15,
  maxTotalPositionPct: 50
};
const INVALIDATION_TRIGGER_OPTIONS = [
  ["close", "收盘确认"],
  ["intraday", "盘中触及"]
];
const TRAILING_RULE_OPTIONS = [
  ["structure", "近期结构低点"],
  ["breakeven", "成本价保护"],
  ["ma5", "5日线保护"],
  ["previous_low", "前一交易日低点"],
  ["manual", "手动复核"]
];

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
let stockNameLookupTimer = 0;
let stockNameLookupRequestId = 0;
let autoSyncTimer = 0;
let autoSyncInFlight = false;
let autoSyncPending = false;
let lastSupabaseError = "";
let todaySortMode = "pinned";
let focusMode = false;
let dashboardSearch = "";
let dashboardStatusFilter = "all";
let historyReportsExpanded = false;
let activePlanSection = "plans";
let planEditorOpen = false;
let planStockLookupTimer = 0;
let planStockLookupRequestId = 0;
let planResolvedStock = null;
let planResolvedQuery = "";
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
    "todaySortBtn",
    "focusModeBtn",
    "marketFreshness",
    "todayStockList",
    "stockCode",
    "stockName",
    "marketPreview",
    "stockConcepts",
    "addStockBtn",
    "stockTableBody",
    "stockEmpty",
    "stockSearch",
    "stockStatusFilter",
    "conceptList",
    "metricStocks",
    "metricDaily",
    "metricConcept",
    "stockCards",
    "buildReportsBtn",
    "copyReportBtn",
    "toggleHistoryReportsBtn",
    "reportList",
    "planDateLabel",
    "planOverviewCount",
    "planOverviewPosition",
    "planOverviewRiskCount",
    "planRiskSummary",
    "togglePlanEditorBtn",
    "closePlanEditorBtn",
    "planEditorPanel",
    "togglePlanStockAddBtn",
    "planStockAddPanel",
    "planStockQuery",
    "planStockAddPreview",
    "planStockConcepts",
    "addPlanStockBtn",
    "planContextName",
    "planContextPrice",
    "planContextChange",
    "planContextRisk",
    "suggestPlanBtn",
    "planRiskPct",
    "planMaxPositionPct",
    "planMaxTotalPositionPct",
    "planSuggestionResult",
    "planStock",
    "planStrategy",
    "planEntryLow",
    "planEntryHigh",
    "planInvalidation",
    "planTarget1",
    "planTarget2",
    "planPositionPct",
    "planEntryLogic",
    "planNoTradeConditions",
    "planNoTradeSummary",
    "planNote",
    "planInvalidationTrigger",
    "planTarget1SellPct",
    "planTarget2SellPct",
    "planTrailingRule",
    "planExitLogic",
    "planExitConditions",
    "planExitConditionSummary",
    "planMaxHoldDays",
    "planExitNote",
    "planExitRemainder",
    "savePlanBtn",
    "resetPlanBtn",
    "planList",
    "reviewPlans",
    "reviewExecuted",
    "reviewSkipped",
    "reviewDiscipline",
    "tradeStock",
    "tradeAction",
    "tradePrice",
    "tradeQuantity",
    "tradeReason",
    "tradeFollowedPlan",
    "saveTradeLogBtn",
    "tradeLogList",
    "snapshotSummary",
    "supabaseUrl",
    "supabaseAnonKey",
    "saveSupabaseBtn",
    "pullSupabaseBtn",
    "replaceFromCloudBtn",
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
  els.stockName.addEventListener("input", handleStockNameInput);
  els.stockName.addEventListener("blur", () => refreshStockCodeFromName());
  els.refreshBtn.addEventListener("click", () => generateDailyUpdate());
  els.todaySortBtn.addEventListener("click", toggleTodaySortMode);
  els.focusModeBtn.addEventListener("click", toggleFocusMode);
  els.stockSearch.addEventListener("input", () => {
    dashboardSearch = normalizeStockSearchText(els.stockSearch.value);
    renderStockTable();
  });
  els.stockStatusFilter.addEventListener("change", () => {
    dashboardStatusFilter = els.stockStatusFilter.value;
    renderStockTable();
  });
  els.buildReportsBtn.addEventListener("click", buildReports);
  els.copyReportBtn.addEventListener("click", copyLatestReport);
  els.toggleHistoryReportsBtn.addEventListener("click", toggleHistoryReports);
  els.savePlanBtn.addEventListener("click", savePlanFromForm);
  els.resetPlanBtn.addEventListener("click", resetPlanForm);
  els.planStock.addEventListener("change", () => loadPlanIntoForm(els.planStock.value));
  els.planStrategy.addEventListener("change", updatePlanSuggestionPrompt);
  els.suggestPlanBtn.addEventListener("click", applySuggestedPlan);
  els.planNoTradeConditions.addEventListener("change", updateConditionSummaries);
  els.planExitConditions.addEventListener("change", updateConditionSummaries);
  els.togglePlanEditorBtn.addEventListener("click", () => showPlanEditor());
  els.closePlanEditorBtn.addEventListener("click", hidePlanEditor);
  els.togglePlanStockAddBtn.addEventListener("click", togglePlanStockAdd);
  els.planStockQuery.addEventListener("input", handlePlanStockQueryInput);
  els.planStockQuery.addEventListener("blur", () => resolvePlanStockQuery());
  els.planStockQuery.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addPlanStockFromPlan();
  });
  els.addPlanStockBtn.addEventListener("click", addPlanStockFromPlan);
  document.querySelectorAll("[data-plan-section]").forEach((button) => {
    button.addEventListener("click", () => setPlanSection(button.dataset.planSection));
  });
  els.planTarget1SellPct.addEventListener("input", updateExitRemainder);
  els.planTarget2SellPct.addEventListener("input", updateExitRemainder);
  els.saveTradeLogBtn.addEventListener("click", saveTradeLogFromForm);
  els.saveSupabaseBtn.addEventListener("click", saveSupabaseConfig);
  els.pullSupabaseBtn.addEventListener("click", pullSupabaseState);
  els.replaceFromCloudBtn.addEventListener("click", replaceWithCloudState);
  els.exportBtn.addEventListener("click", exportData);
  els.importFile.addEventListener("change", importData);
  els.rebuildBtn.addEventListener("click", rebuildConcepts);
  els.clearBtn.addEventListener("click", clearData);
}

function emptyState() {
  return {
    stocks: [],
    prices: [],
    news: [],
    concepts: [],
    reports: [],
    plans: [],
    tradeLogs: [],
    snapshots: [],
    riskSettings: { ...DEFAULT_RISK_SETTINGS },
    deletedStocks: [],
    syncMeta: {}
  };
}

async function loadState() {
  const fallback = emptyState();
  loadSupabaseForm();
  const localState = loadLocalState();
  const hasSupabaseConfig = Boolean(getSupabaseConfig());

  if (localState) {
    updateSupabaseStatus(hasSupabaseConfig ? "本机数据已载入，云端同步中" : "本机存储");
    if (hasSupabaseConfig) setTimeout(refreshCloudAfterStartup, 0);
    return localState;
  }

  const cloudState = await loadSupabaseState();
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

  return fallback;
}

async function refreshCloudAfterStartup() {
  const cloudState = await loadSupabaseState(false, false, false);
  if (!cloudState) {
    updateSupabaseStatus("云端暂不可用，已保留本机数据");
    return;
  }
  const latestLocal = loadLocalState() || state;
  const merged = mergeCloudIntoLocal(latestLocal, cloudState);
  state = merged;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  updateSupabaseStatus(`已合并本机与云端：${stateSummary(merged)}`);
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

async function runSupabaseSave(snapshotFactory, forceStatus = false, replaceCloud = false) {
  while (autoSyncInFlight) {
    await delay(250);
  }
  autoSyncInFlight = true;
  try {
    const snapshot = typeof snapshotFactory === "function" ? snapshotFactory() : snapshotFactory;
    return await saveSupabaseState(snapshot, forceStatus, replaceCloud);
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
    const ok = await runSupabaseSave(currentStateSnapshot, true, true);
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
  const previousCount = localState ? localState.stocks.length : 0;
  state = localState ? mergeCloudIntoLocal(localState, cloudState) : normalizeState(cloudState);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  updateSupabaseStatus(`已合并本机与云端：${stateSummary(state)}`);
  const deletedCount = Math.max(0, previousCount - state.stocks.length);
  showToast(deletedCount ? `已同步，删除${deletedCount}只` : "已合并本机与云端");
}

async function replaceWithCloudState() {
  if (!saveSupabaseConfigFromForm()) return;
  if (!confirm("将以云端数据替换当前浏览器数据。本机当前数据会先保留备份，确认继续吗？")) return;
  cancelQueuedSupabaseSync();
  lastSupabaseError = "";
  updateSupabaseStatus("云端恢复中");
  els.replaceFromCloudBtn.disabled = true;
  try {
    const cloudState = await loadSupabaseState(true, false, false);
    if (!cloudState) {
      updateSupabaseStatus(`恢复失败：${lastSupabaseError || "云端暂无数据"}`);
      showToast(lastSupabaseError || "云端暂无数据或连接失败");
      return;
    }
    const localState = loadLocalState();
    if (localState) localStorage.setItem(CLOUD_RESTORE_BACKUP_KEY, JSON.stringify(localState));
    state = normalizeState(cloudState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
    updateSupabaseStatus(`已按云端恢复：${stateSummary(state)}`);
    showToast("已按云端数据恢复，本机旧数据已备份");
  } finally {
    els.replaceFromCloudBtn.disabled = false;
  }
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

async function saveSupabaseState(nextState, forceStatus = false, replaceCloud = false) {
  const config = getSupabaseConfig();
  if (!config) return false;
  try {
    const cloudBeforeWrite = replaceCloud ? null : await loadSupabaseState(false, false, false);
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
    prices: Array.isArray(value?.prices) ? value.prices.map(normalizePrice).filter((item) => item.stockId && item.date && item.close !== null) : [],
    news: Array.isArray(value?.news) ? value.news : [],
    concepts: legacyConcepts,
    reports: Array.isArray(value?.reports) ? value.reports : [],
    plans: Array.isArray(value?.plans) ? value.plans.map(normalizePlan) : [],
    tradeLogs: Array.isArray(value?.tradeLogs) ? value.tradeLogs.map(normalizeTradeLog) : [],
    snapshots: Array.isArray(value?.snapshots) ? value.snapshots.map(normalizeSnapshot) : [],
    riskSettings: normalizeRiskSettings(value?.riskSettings),
    deletedStocks: dedupeDeletedStocks(deletedStocks).filter((item) => item.id || item.code),
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
  const createdAt = stock?.createdAt || stock?.created_at || stock?.addedAt || stock?.added_at || LEGACY_CREATED_AT_FALLBACK;
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
    createdAt,
    addedAt: stock?.addedAt || stock?.added_at || formatDate(new Date()),
    updatedAt: stock?.updatedAt || stock?.updated_at || stock?.addedAt || stock?.added_at || createdAt,
    active: stock?.active !== false,
    pinned: stock?.pinned === true,
    workflowStatus: normalizeWorkflowStatus(stock?.workflowStatus || stock?.status),
    strategy: normalizeStrategy(stock?.strategy),
    concepts
  };
}

function normalizePlan(item) {
  const stockId = String(item?.stockId || "");
  const date = String(item?.date || "");
  const target1Value = finiteNumberOrNull(item?.target1);
  const target2Value = finiteNumberOrNull(item?.target2);
  const target1SellPct = finiteNumberOrDefault(item?.target1SellPct, target1Value === null ? 0 : 30);
  const target2SellPct = finiteNumberOrDefault(item?.target2SellPct, target2Value === null ? 0 : 30);
  return {
    id: String(item?.id || `${stockId}-${date}` || makeId()),
    stockId,
    date,
    strategy: normalizeStrategy(item?.strategy),
    entryLow: finiteNumberOrNull(item?.entryLow),
    entryHigh: finiteNumberOrNull(item?.entryHigh),
    invalidation: finiteNumberOrNull(item?.invalidation),
    target1: target1Value,
    target2: target2Value,
    positionPct: finiteNumberOrNull(item?.positionPct),
    entryLogic: normalizeOptionValue(item?.entryLogic, ENTRY_LOGIC_OPTIONS, ""),
    noTradeConditions: normalizeOptionValues(item?.noTradeConditions, NO_TRADE_CONDITION_OPTIONS),
    note: String(item?.note || "").trim(),
    invalidationTrigger: normalizeInvalidationTrigger(item?.invalidationTrigger),
    target1SellPct,
    target2SellPct,
    trailingRule: normalizeTrailingRule(item?.trailingRule),
    exitLogic: normalizeOptionValue(item?.exitLogic, EXIT_LOGIC_OPTIONS, "invalidation"),
    exitConditions: normalizeOptionValues(item?.exitConditions, EXIT_CONDITION_OPTIONS),
    maxHoldDays: finiteNumberOrNull(item?.maxHoldDays),
    exitNote: String(item?.exitNote || "").trim(),
    createdAt: item?.createdAt || item?.created_at || new Date().toISOString(),
    updatedAt: item?.updatedAt || item?.updated_at || item?.createdAt || new Date().toISOString()
  };
}

function normalizePrice(item) {
  return {
    ...item,
    id: String(item?.id || makeId()),
    stockId: String(item?.stockId || ""),
    date: String(item?.date || ""),
    open: finiteNumberOrNull(item?.open),
    high: finiteNumberOrNull(item?.high),
    low: finiteNumberOrNull(item?.low),
    close: finiteNumberOrNull(item?.close),
    volume: finiteNumberOrNull(item?.volume),
    amount: finiteNumberOrNull(item?.amount),
    changePct: finiteNumberOrNull(item?.changePct)
  };
}

function normalizeRiskSettings(value) {
  const riskPerTradePct = finiteNumberOrDefault(value?.riskPerTradePct, DEFAULT_RISK_SETTINGS.riskPerTradePct);
  const maxPositionPct = finiteNumberOrDefault(value?.maxPositionPct, DEFAULT_RISK_SETTINGS.maxPositionPct);
  const maxTotalPositionPct = finiteNumberOrDefault(value?.maxTotalPositionPct, DEFAULT_RISK_SETTINGS.maxTotalPositionPct);
  return {
    riskPerTradePct: clampNumber(riskPerTradePct, 0.1, 5),
    maxPositionPct: clampNumber(maxPositionPct, 1, 100),
    maxTotalPositionPct: clampNumber(maxTotalPositionPct, 1, 100)
  };
}

function normalizeTradeLog(item) {
  return {
    id: String(item?.id || makeId()),
    stockId: String(item?.stockId || ""),
    stockName: String(item?.stockName || "").trim(),
    stockCode: String(item?.stockCode || "").trim(),
    date: String(item?.date || formatDate(new Date())),
    action: ["buy", "sell", "skip"].includes(item?.action) ? item.action : "skip",
    price: finiteNumberOrNull(item?.price),
    quantity: finiteNumberOrNull(item?.quantity),
    reason: String(item?.reason || "").trim(),
    followedPlan: item?.followedPlan !== false,
    createdAt: item?.createdAt || item?.created_at || new Date().toISOString(),
    updatedAt: item?.updatedAt || item?.updated_at || item?.createdAt || new Date().toISOString()
  };
}

function normalizeSnapshot(item) {
  return {
    id: String(item?.id || item?.date || makeId()),
    date: String(item?.date || ""),
    createdAt: item?.createdAt || item?.created_at || new Date().toISOString(),
    stocks: Array.isArray(item?.stocks) ? item.stocks : []
  };
}

function normalizeDeletedStock(item) {
  return {
    id: String(item?.id || ""),
    code: cleanCode(item?.code || ""),
    market: item?.market || inferMarket(item?.code || ""),
    deletedAt: item?.deletedAt || item?.deleted_at || formatDate(new Date())
  };
}

function mergeStates(primary, secondary, options = {}) {
  const base = normalizeState(primary);
  const incoming = normalizeState(secondary);
  const primaryDeletedStocks = options.keepIncomingStocksOverPrimaryDeletes
    ? base.deletedStocks.filter((record) => {
        const matchingIncomingStock = incoming.stocks.find((stock) => deleteRecordAppliesToStock(record, stock));
        return !matchingIncomingStock || stockCreateTime(matchingIncomingStock) <= deletedStockTime(record);
      })
    : base.deletedStocks;
  const deletedStocks = dedupeDeletedStocks(
    [...primaryDeletedStocks, ...incoming.deletedStocks]
  );
  const idMap = new Map();
  const stocks = [];

  [...base.stocks, ...incoming.stocks].forEach((stock) => {
    if (deletedStocks.some((record) => deleteRecordAppliesToStock(record, stock) && deletedStockTime(record) >= stockCreateTime(stock))) return;
    const existing = stocks.find((item) => item.market === stock.market && item.code === stock.code);
    if (!existing) {
      stocks.push({ ...stock, concepts: normalizeConceptList(stock.concepts) });
      return;
    }
    idMap.set(stock.id, existing.id);
    const existingUpdatedTime = timestampValue(existing.updatedAt);
    const stockUpdatedTime = timestampValue(stock.updatedAt);
    const stockIsNewer = stockUpdatedTime > existingUpdatedTime;
    existing.name = existing.name || stock.name;
    existing.addedAt = existing.addedAt <= stock.addedAt ? existing.addedAt : stock.addedAt;
    existing.createdAt = timestampValue(existing.createdAt) <= timestampValue(stock.createdAt) ? existing.createdAt : stock.createdAt;
    existing.updatedAt = existingUpdatedTime >= stockUpdatedTime ? existing.updatedAt : stock.updatedAt;
    if (stockIsNewer) {
      existing.active = stock.active !== false;
      existing.pinned = stock.pinned === true;
      existing.workflowStatus = normalizeWorkflowStatus(stock.workflowStatus);
      existing.strategy = normalizeStrategy(stock.strategy);
    }
    existing.concepts = normalizeConceptList([...(existing.concepts || []), ...(stock.concepts || [])]);
  });

  const prices = dedupePrices(
    [...base.prices, ...incoming.prices].map((price) => remapStockRef(price, idMap)),
    (price) => `${price.stockId}-${price.date}`
  );
  const news = dedupeBy(
    [...base.news, ...incoming.news].map((item) => remapStockRef(item, idMap)),
    (item) => `${item.stockId}-${item.date}-${item.title}`
  );
  const reports = dedupeBy([...base.reports, ...incoming.reports], (item) => item.id || `${item.type}-${item.date}`);
  const plans = dedupeLatestBy(
    [...base.plans, ...incoming.plans].map((item) => remapStockRef(item, idMap)),
    (item) => `${item.stockId}-${item.date}`
  );
  const tradeLogs = dedupeLatestBy(
    [...base.tradeLogs, ...incoming.tradeLogs].map((item) => remapStockRef(item, idMap)),
    (item) => item.id
  );
  const snapshots = dedupeLatestBy([...base.snapshots, ...incoming.snapshots], (item) => item.id || item.date);
  const merged = {
    stocks,
    prices,
    news,
    concepts: [],
    reports,
    plans,
    tradeLogs,
    snapshots,
    riskSettings: base.riskSettings,
    deletedStocks
  };
  syncConceptSnapshotForState(merged);
  return applyDeletedStocks(merged);
}

function mergeCloudIntoLocal(localState, cloudState) {
  const cloud = normalizeState(cloudState);
  const merged = mergeStates(localState, cloud, { keepIncomingStocksOverPrimaryDeletes: true });
  merged.deletedStocks = dedupeDeletedStocks(
    [...(merged.deletedStocks || []), ...(cloud.deletedStocks || [])]
  );
  return applyDeletedStocks(merged);
}

function remapStockRef(item, idMap) {
  const next = { ...item };
  if (idMap.has(next.stockId)) next.stockId = idMap.get(next.stockId);
  return next;
}

function applyDeletedStocks(nextState) {
  const deletedStocks = dedupeDeletedStocks(nextState.deletedStocks || []);
  const stocks = (nextState.stocks || []).filter(
    (stock) => !deletedStocks.some((record) => deleteRecordAppliesToStock(record, stock) && deletedStockTime(record) >= stockCreateTime(stock))
  );
  const activeDeletedStocks = deletedStocks.filter(
    (record) => !stocks.some((stock) => deleteRecordAppliesToStock(record, stock) && stockCreateTime(stock) > deletedStockTime(record))
  );
  const stockIds = new Set(stocks.map((stock) => stock.id));
  return {
    ...nextState,
    stocks,
    deletedStocks: activeDeletedStocks,
    prices: (nextState.prices || []).filter((price) => stockIds.has(price.stockId)),
    news: (nextState.news || []).filter((item) => stockIds.has(item.stockId)),
    concepts: (nextState.concepts || []).filter((item) => stockIds.has(item.stockId)),
    plans: (nextState.plans || []).filter((item) => stockIds.has(item.stockId))
  };
}

function deleteRecordAppliesToStock(record, stock) {
  if (!record || !stock) return false;
  if (record.id && stock.id && record.id === stock.id) return true;
  if (record.code && stock.code && cleanCode(record.code) === cleanCode(stock.code)) return true;
  if (record.code && record.market && stock.code && stock.market) {
    return `${record.market}-${cleanCode(record.code)}` === `${stock.market}-${cleanCode(stock.code)}`;
  }
  return false;
}

function stockCreateTime(stock) {
  return timestampValue(stock?.createdAt || stock?.created_at || stock?.addedAt || stock?.added_at);
}

function deletedStockTime(record) {
  return timestampValue(record?.deletedAt || record?.deleted_at);
}

function timestampValue(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

function deleteRecordKey(item) {
  return `${item.id || ""}|${item.market || ""}|${item.code || ""}`;
}

function dedupeDeletedStocks(items) {
  const map = new Map();
  items.filter(Boolean).forEach((item) => {
    const record = normalizeDeletedStock(item);
    if (!record.id && !record.code) return;
    const key = deleteRecordKey(record);
    const existing = map.get(key);
    if (!existing || deletedStockTime(record) >= deletedStockTime(existing)) map.set(key, record);
  });
  return [...map.values()];
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

function dedupePrices(items, keyFn) {
  const map = new Map();
  items.filter(Boolean).forEach((item) => {
    const price = normalizePrice(item);
    const key = keyFn(price);
    if (!key) return;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, price);
      return;
    }
    const merged = { ...price, ...existing };
    ["open", "high", "low", "close", "volume", "amount", "changePct"].forEach((field) => {
      if (merged[field] === null) merged[field] = existing[field] ?? price[field] ?? null;
    });
    map.set(key, merged);
  });
  return [...map.values()];
}

function dedupeLatestBy(items, keyFn) {
  const map = new Map();
  items.filter(Boolean).forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    const existing = map.get(key);
    if (!existing || timestampValue(item.updatedAt || item.createdAt) >= timestampValue(existing.updatedAt || existing.createdAt)) {
      map.set(key, item);
    }
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
        workflowStatus: normalizeWorkflowStatus(stock.workflowStatus),
        strategy: normalizeStrategy(stock.strategy),
        createdAt: stock.createdAt || "",
        updatedAt: stock.updatedAt || "",
        concepts: normalizeConceptList(stock.concepts).sort((a, b) => a.localeCompare(b))
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    prices: [...data.prices]
      .map((price) => ({
        key: `${stockById.get(price.stockId) || price.stockId}-${price.date}`,
        stock: stockById.get(price.stockId) || price.stockId,
        date: price.date,
        open: Number.isFinite(Number(price.open)) ? Number(price.open).toFixed(4) : "",
        high: Number.isFinite(Number(price.high)) ? Number(price.high).toFixed(4) : "",
        low: Number.isFinite(Number(price.low)) ? Number(price.low).toFixed(4) : "",
        close: Number.isFinite(Number(price.close)) ? Number(price.close).toFixed(4) : "",
        volume: Number.isFinite(Number(price.volume)) ? Number(price.volume).toFixed(4) : "",
        amount: Number.isFinite(Number(price.amount)) ? Number(price.amount).toFixed(4) : "",
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
    plans: [...data.plans]
      .map((item) => ({
        key: item.id || `${stockById.get(item.stockId) || item.stockId}-${item.date}`,
        stock: stockById.get(item.stockId) || item.stockId,
        date: item.date,
        strategy: item.strategy,
        entryLow: item.entryLow,
        entryHigh: item.entryHigh,
        invalidation: item.invalidation,
        target1: item.target1,
        target2: item.target2,
        positionPct: item.positionPct,
        entryLogic: item.entryLogic,
        noTradeConditions: item.noTradeConditions,
        note: item.note,
        invalidationTrigger: item.invalidationTrigger,
        target1SellPct: item.target1SellPct,
        target2SellPct: item.target2SellPct,
        trailingRule: item.trailingRule,
        exitLogic: item.exitLogic,
        exitConditions: item.exitConditions,
        maxHoldDays: item.maxHoldDays,
        exitNote: item.exitNote,
        updatedAt: item.updatedAt || ""
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    riskSettings: data.riskSettings,
    tradeLogs: [...data.tradeLogs]
      .map((item) => ({
        key: item.id,
        stock: stockById.get(item.stockId) || item.stockCode || item.stockId,
        date: item.date,
        action: item.action,
        price: item.price,
        quantity: item.quantity,
        reason: item.reason,
        followedPlan: item.followedPlan !== false,
        updatedAt: item.updatedAt || ""
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    snapshots: [...data.snapshots]
      .map((item) => ({
        key: item.id || item.date,
        date: item.date,
        createdAt: item.createdAt || "",
        stocks: item.stocks
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    deletedStocks: [...(data.deletedStocks || [])]
      .map((item) => ({
        key: `${item.id || ""}|${item.market || ""}|${item.code || ""}`,
        id: item.id || "",
        code: item.code || "",
        market: item.market || "",
        deletedAt: item.deletedAt || ""
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
  els.todayLabel.textContent = formatDateWithWeekday(new Date());
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

function setPlanSection(sectionName) {
  const next = ["plans", "execution", "review"].includes(sectionName) ? sectionName : "plans";
  activePlanSection = next;
  document.querySelectorAll("[data-plan-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.planSection === next);
  });
  document.querySelectorAll("[data-plan-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.planPanel === next);
  });
}

async function addStockFromForm() {
  if (!cleanCode(els.stockCode.value) && els.stockName.value.trim()) {
    await refreshStockCodeFromName(true);
  }

  const code = cleanCode(els.stockCode.value);
  const market = inferMarket(code);
  const concepts = parseConceptInput(els.stockConcepts.value);

  if (!code) {
    showToast("请输入股票代码或名称");
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

  const now = new Date();
  const nextStock = {
    id: makeId(),
    code,
    name,
    market,
    concepts,
    createdAt: now.toISOString(),
    addedAt: formatDate(now),
    updatedAt: now.toISOString(),
    active: true,
    pinned: false,
    workflowStatus: "watch",
    strategy: ""
  };

  state.deletedStocks = (state.deletedStocks || []).filter((record) => !deleteRecordAppliesToStock(record, nextStock));
  state.stocks.unshift(nextStock);

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
        createdAt: new Date().toISOString(),
        addedAt: formatDate(new Date()),
        updatedAt: new Date().toISOString(),
        active: true,
        pinned: false,
        workflowStatus: "watch",
        strategy: ""
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
  let completed = 0;
  els.refreshBtn.disabled = true;

  if (showMessage) showToast(`正在更新 0/${activeStocks.length}`, 5000);

  const results = await mapWithConcurrency(activeStocks, 6, async (stock) => {
    const quote = await fetchStockQuote(stock.code, stock.market).catch(() => null);
    completed += 1;
    if (showMessage) showToast(`正在更新 ${completed}/${activeStocks.length}`, 5000);
    return { stock, quote };
  });

  for (const { stock, quote } of results) {
    if (!quote?.close || quote.changePct === null) {
      failed += 1;
      continue;
    }

    if (quote.name && quote.name !== stock.name) stock.name = quote.name;
    stock.updatedAt = new Date().toISOString();
    upsertPrice({
      stockId: stock.id,
      date: quote.date || formatDate(new Date()),
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: round(quote.close, 2),
      volume: quote.volume,
      amount: quote.amount,
      changePct: round(quote.changePct, 2)
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
  captureDailySnapshot(formatDate(new Date()));
  saveState();
  render();
  if (showMessage) {
    showToast(failed ? `已更新${updated}只，${failed}只未取到` : "真实行情已更新");
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
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

function buildReports(showMessage = true, reportDate = new Date()) {
  const todayDate = parseLocalDate(formatDate(reportDate));
  const today = formatDate(todayDate);
  const schedule = reportScheduleForDate(todayDate);

  if (!schedule.length) {
    if (showMessage) showToast(`${today} 非交易日，不生成日报`);
    return;
  }

  if (!state.prices.some((price) => price.date === today)) {
    if (showMessage) showToast(`${today} 暂无当日行情，不生成日报`);
    return;
  }

  const reports = schedule.map((item) => ({
    id: item.id,
    type: item.type,
    date: today,
    content: buildReportContent(item.type, today, item.period)
  }));

  state.reports = state.reports.filter(isScheduledReport);

  reports.forEach((report) => {
    const existingIndex = state.reports.findIndex((item) => item.id === report.id);
    if (existingIndex >= 0) state.reports[existingIndex] = report;
    else state.reports.push(report);
  });

  captureDailySnapshot(today);
  saveState();
  render();
  if (showMessage) showToast(`已生成${reports.map((report) => report.type).join("、")}`);
}

function buildReportContent(title, date, period) {
  const model = buildDailyReportModel(date, period);
  if (!model.rows.length) return `${date} ${title}\n\n暂无行情记录`;

  const lines = [
    `${date} ${title}`,
    "",
    "【市场概览】",
    `关注 ${model.rows.length} 只｜上涨 ${model.upCount}｜下跌 ${model.downCount}｜平盘 ${model.flatCount}｜平均 ${formatPct(model.average)}`,
    `最热概念：${model.hotConcept ? `${model.hotConcept.tag}（${model.hotConcept.count}只）` : "暂无"}`,
    "",
    "【强弱表现】",
    `强势：${formatReportMoverLine(model.gainers)}`,
    `弱势：${formatReportMoverLine(model.decliners)}`,
    "",
    "【重点复盘】"
  ];

  model.focusRows.forEach((row, index) => {
    const concepts = conceptsForStock(row.stock.id).join("、") || "暂无概念";
    const risk = riskSuggestionFor(row.stock);
    lines.push(
      `${index + 1}. ${row.stock.name} ${formatPct(row.ret)}｜最新 ${formatNumber(row.latest.close)}｜${concepts}｜${risk.label}`
    );
    lines.push(`   ${compactRiskReason(risk.reason)}`);
  });

  lines.push("", "【次日计划】");
  if (model.planRows.length) {
    model.planRows.forEach(({ stock, plan }) => {
      lines.push(
        `${stock.name}｜入场${strategyLabel(plan.strategy)}｜买入 ${formatPlanEntry(plan)}｜失效 ${formatOptionalPrice(plan.invalidation)}｜目标 ${formatPlanTargets(plan)}｜仓位 ${plan.positionPct === null ? "-" : `${formatNumber(plan.positionPct)}%`}`
      );
      lines.push(`   卖出：${formatPlanExitText(plan)}${plan.exitNote ? `；${plan.exitNote}` : ""}`);
    });
  } else {
    lines.push("尚未制定下一交易日计划");
  }

  lines.push(
    "",
    "【数据说明】",
    model.insufficientCount
      ? `${model.insufficientCount} 只股票历史记录不足5个交易日，仅统计当日表现，不输出方向判断。`
      : "全部关注股票均已有至少5个交易日记录。"
  );

  return lines.join("\n");
}

function buildDailyReportModel(date, period = "daily") {
  const rows = activeOrderedStocks()
    .map((stock) => {
      const price = state.prices.find((item) => item.stockId === stock.id && item.date === date);
      if (!price) return null;
      const ret = period === "daily" ? Number(price.changePct) : periodReturn(stock.id, period);
      return {
        stock,
        latest: price,
        ret: Number.isFinite(Number(ret)) ? Number(ret) : 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.ret - a.ret);

  const changes = rows.map((row) => row.ret);
  const average = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : 0;
  const upCount = changes.filter((value) => value > 0).length;
  const downCount = changes.filter((value) => value < 0).length;
  const flatCount = changes.length - upCount - downCount;
  const gainers = rows.filter((row) => row.ret > 0).slice(0, 3);
  const decliners = [...rows].reverse().filter((row) => row.ret < 0).slice(0, 3);
  const nextDate = formatDate(nextTradingDay(parseLocalDate(date)));
  const planRows = activeOrderedStocks()
    .map((stock) => ({ stock, plan: planForStock(stock.id, nextDate) }))
    .filter((item) => item.plan);
  const plannedIds = new Set(planRows.map((item) => item.stock.id));
  const focusRows = [];
  const focusIds = new Set();

  [
    ...rows.filter((row) => plannedIds.has(row.stock.id) || row.stock.workflowStatus === "holding"),
    ...gainers,
    ...decliners
  ].forEach((row) => {
    if (!row || focusIds.has(row.stock.id) || focusRows.length >= 10) return;
    focusIds.add(row.stock.id);
    focusRows.push(row);
  });

  const conceptCounts = new Map();
  rows.forEach((row) => {
    conceptsForStock(row.stock.id).forEach((tag) => conceptCounts.set(tag, (conceptCounts.get(tag) || 0) + 1));
  });
  const hotConcept = [...conceptCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))[0] || null;
  const insufficientCount = rows.filter(
    (row) => state.prices.filter((price) => price.stockId === row.stock.id && price.date <= date).length < 5
  ).length;

  return {
    date,
    rows,
    average,
    upCount,
    downCount,
    flatCount,
    gainers,
    decliners,
    planRows,
    focusRows,
    hotConcept,
    insufficientCount
  };
}

function formatReportMoverLine(rows) {
  return rows.length
    ? rows.map((row) => `${row.stock.name} ${formatPct(row.ret)}`).join("；")
    : "暂无";
}

function compactRiskReason(reason) {
  return String(reason || "")
    .replace(/，暂未形成明确操作信号$/, "")
    .replace(/，今日下跌与短线趋势同向$/, "")
    .replace(/，今日上涨但波动处于高位$/, "")
    .replace(/，趋势偏强且波动尚可$/, "");
}

function render() {
  renderTodayList();
  renderMarketFreshness();
  renderMetrics();
  renderStockTable();
  renderConcepts();
  renderStockCards();
  renderPlanWorkspace();
  renderReviewMetrics();
  renderTradeLogs();
  renderSnapshots();
  renderReports();
}

function renderTodayList() {
  if (!els.todayStockList) return;
  if (els.todaySortBtn) {
    els.todaySortBtn.textContent = todaySortMode === "change" ? "置顶优先" : "涨幅排序";
    els.todaySortBtn.classList.toggle("active", todaySortMode === "change");
  }
  if (els.focusModeBtn) {
    els.focusModeBtn.textContent = focusMode ? "退出盘中" : "盘中模式";
    els.focusModeBtn.classList.toggle("active", focusMode);
  }
  document.getElementById("todayView")?.classList.toggle("focus-mode", focusMode);
  const visibleStocks = todayVisibleStocks();
  els.todayStockList.innerHTML = visibleStocks.length
    ? visibleStocks
        .map((stock) => {
          const latest = latestPrice(stock.id);
          const changeClass = latest?.changePct === undefined || latest?.changePct === null ? "" : Number(latest.changePct) >= 0 ? "positive" : "negative";
          const concepts = conceptsForStock(stock.id).slice(0, 2);
          const plan = planForStock(stock.id);
          const planState = plan ? planDecisionState(plan, latest) : null;
          return `
            <article class="today-stock-row">
              <div class="today-stock-name">
                <strong>${escapeHtml(stock.name)}</strong>
                <span>${stock.market}${stock.code} · ${latest?.date || "无行情"}</span>
                <em class="workflow-badge status-${stock.workflowStatus}">${escapeHtml(workflowStatusLabel(stock.workflowStatus))}</em>
              </div>
              <div class="today-stock-value">
                <span>最新价</span>
                <strong>${latest ? formatNumber(latest.close) : "-"}</strong>
              </div>
              <div class="today-stock-value ${changeClass}">
                <span>今日</span>
                <strong>${latest ? formatPct(latest.changePct) : "-"}</strong>
              </div>
              <div class="today-stock-concepts">
                <span>概念</span>
                <div>${concepts.length ? concepts.map((tag) => `<em>${escapeHtml(tag)}</em>`).join("") : '<strong class="muted">-</strong>'}</div>
              </div>
              ${
                plan
                  ? `<div class="today-plan-levels">
                      <span>计划 ${formatPlanEntry(plan)}</span>
                      <span>失效 ${formatOptionalPrice(plan.invalidation)}</span>
                      <strong class="plan-state plan-state-${planState.tone}">${escapeHtml(planState.label)}</strong>
                    </div>`
                  : `<div class="today-plan-levels no-plan"><span>尚未制定次日计划</span></div>`
              }
              <button class="today-pin-button ${stock.pinned ? "active" : ""}" data-action="pin-today" data-stock-id="${stock.id}" title="${stock.pinned ? "取消置顶" : "置顶"}" aria-label="${stock.pinned ? "取消置顶" : "置顶"}">${stock.pinned ? "取消" : "置顶"}</button>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state inline-empty show">暂无股票</div>`;

  els.todayStockList.querySelectorAll("[data-action='pin-today']").forEach((button) => {
    button.addEventListener("click", () => togglePinnedStock(button.dataset.stockId));
  });
}

function toggleTodaySortMode() {
  todaySortMode = todaySortMode === "change" ? "pinned" : "change";
  renderTodayList();
}

function toggleFocusMode() {
  focusMode = !focusMode;
  renderTodayList();
}

function todayVisibleStocks() {
  const ordered = todayOrderedStocks();
  if (!focusMode) return ordered;
  return ordered.filter((stock) => ["planned", "holding"].includes(stock.workflowStatus));
}

function todayOrderedStocks() {
  const stocks = activeOrderedStocks();
  if (todaySortMode !== "change") return stocks;
  return stocks.sort((a, b) => {
    const aLatest = latestPrice(a.id);
    const bLatest = latestPrice(b.id);
    const aHasChange = Number.isFinite(Number(aLatest?.changePct));
    const bHasChange = Number.isFinite(Number(bLatest?.changePct));
    if (aHasChange !== bHasChange) return aHasChange ? -1 : 1;
    if (aHasChange && bHasChange) return Number(bLatest.changePct) - Number(aLatest.changePct);
    return Number(b.pinned === true) - Number(a.pinned === true);
  });
}

function renderMarketFreshness() {
  if (!els.marketFreshness) return;
  const date = latestDataDate();
  if (!date) {
    els.marketFreshness.textContent = "暂无行情";
    els.marketFreshness.className = "status-pill market-freshness data-stale";
    return;
  }
  const target = lastTradingDate(new Date());
  const isFresh = date >= formatDate(target);
  els.marketFreshness.textContent = `${isFresh ? "行情" : "历史"} ${date}`;
  els.marketFreshness.className = `status-pill market-freshness ${isFresh ? "data-fresh" : "data-stale"}`;
}

function latestDataDate() {
  return state.prices.reduce((latest, item) => (item.date > latest ? item.date : latest), "");
}

function riskSuggestionFor(stock) {
  const history = state.prices
    .filter((price) => price.stockId === stock.id && Number.isFinite(Number(price.close)))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = history.at(-1);

  if (!latest || history.length < 5) {
    return {
      tone: "muted",
      label: "数据积累中",
      reason: `当前记录${history.length}个交易日，积累至少5日后开始判断波动`
    };
  }

  const returns = [];
  for (let index = 1; index < history.length; index += 1) {
    const previousClose = Number(history[index - 1].close);
    const currentClose = Number(history[index].close);
    if (previousClose > 0 && currentClose > 0) returns.push(((currentClose - previousClose) / previousClose) * 100);
  }

  const recentReturns = returns.slice(-10);
  const averageReturn = recentReturns.reduce((sum, value) => sum + value, 0) / recentReturns.length;
  const variance = recentReturns.reduce((sum, value) => sum + (value - averageReturn) ** 2, 0) / recentReturns.length;
  const dailyVolatility = Math.sqrt(variance);
  const recentStart = Number(history[Math.max(0, history.length - 5)].close);
  const latestClose = Number(latest.close);
  const recentTrend = recentStart > 0 ? ((latestClose - recentStart) / recentStart) * 100 : 0;
  const peak = Math.max(...history.map((price) => Number(price.close)));
  const drawdown = peak > 0 ? ((latestClose - peak) / peak) * 100 : 0;
  const latestChange = Number(latest.changePct);
  const volatilityLabel = dailyVolatility >= 3 ? "高" : dailyVolatility >= 1.8 ? "中" : "低";
  const detail = `近${recentReturns.length}日波动${dailyVolatility.toFixed(2)}%/日，5日趋势${formatPct(recentTrend)}，阶段回撤${formatPct(drawdown)}`;

  if (latestChange <= -5 && recentTrend < 0) {
    return { tone: "risk", label: "风险复核", reason: `${detail}，今日下跌与短线趋势同向` };
  }
  if (latestChange >= 5 && dailyVolatility >= 3) {
    return { tone: "caution", label: "暂缓追涨", reason: `${detail}，今日上涨但波动处于高位` };
  }
  if (recentTrend >= 3 && dailyVolatility < 3) {
    return { tone: "hold", label: "持有观察", reason: `${detail}，趋势偏强且波动尚可` };
  }
  return { tone: "watch", label: "观察", reason: `${detail}，暂未形成明确操作信号` };
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
}

function renderStockTable() {
  els.stockTableBody.innerHTML = "";
  const visibleStocks = dashboardFilteredStocks();
  els.stockEmpty.textContent = activeOrderedStocks().length ? "没有符合筛选条件的股票" : "暂无股票";
  els.stockEmpty.classList.toggle("show", visibleStocks.length === 0);

  visibleStocks.forEach((stock) => {
    const latest = latestPrice(stock.id);
    const row = document.createElement("tr");
    const tags = conceptsForStock(stock.id).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
    row.innerHTML = `
      <td data-label="股票">
        <div class="stock-title stock-title-plain">
          <strong>${escapeHtml(stock.name)}</strong>
          <span>${stock.market}${stock.code}</span>
          <em class="workflow-badge status-${stock.workflowStatus}">${escapeHtml(workflowStatusLabel(stock.workflowStatus))}</em>
        </div>
      </td>
      <td data-label="添加日">${stock.addedAt}</td>
      <td data-label="最新价">${latest ? formatNumber(latest.close) : '<span class="muted">-</span>'}</td>
      <td data-label="添加以来">${pctHtml(sinceAddedReturn(stock.id, stock.addedAt))}</td>
      <td data-label="今日">${latest ? pctHtml(latest.changePct) : '<span class="muted">-</span>'}</td>
      <td data-label="周">${pctHtml(periodReturn(stock.id, "weekly"))}</td>
      <td data-label="月">${pctHtml(periodReturn(stock.id, "monthly"))}</td>
      <td data-label="概念"><div class="tag-row">${tags || '<span class="muted">-</span>'}</div></td>
      <td data-label="走势" class="sparkline-cell">${sparklineForStock(stock.id)}</td>
    `;
    els.stockTableBody.appendChild(row);
  });

}

function dashboardFilteredStocks() {
  return activeOrderedStocks().filter((stock) => {
    if (dashboardStatusFilter !== "all" && stock.workflowStatus !== dashboardStatusFilter) return false;
    if (!dashboardSearch) return true;
    const text = normalizeStockSearchText(
      `${stock.name} ${stock.market}${stock.code} ${conceptsForStock(stock.id).join(" ")} ${workflowStatusLabel(stock.workflowStatus)} ${strategyLabel(stock.strategy)}`
    );
    return text.includes(dashboardSearch);
  });
}

function sparklineForStock(stockId) {
  const history = state.prices
    .filter((price) => price.stockId === stockId && Number.isFinite(Number(price.close)) && Number(price.close) > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-20);

  if (!history.length) return '<span class="sparkline-empty">暂无数据</span>';

  const values = history.map((price) => Number(price.close));
  const width = 132;
  const height = 48;
  const paddingX = 3;
  const paddingY = 12;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingY * 2;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : paddingX + (index / (values.length - 1)) * plotWidth;
    const y = range === 0 ? height / 2 : paddingY + ((max - value) / range) * plotHeight;
    return { x: round(x, 2), y: round(y, 2) };
  });
  const first = values[0];
  const last = values.at(-1);
  const tone = last > first ? "up" : last < first ? "down" : "flat";
  const change = first > 0 ? ((last - first) / first) * 100 : 0;
  const highText = formatNumber(max);
  const lowText = formatNumber(min);
  const label = `最近${history.length}个交易日，最高${highText}，最低${lowText}，${formatNumber(first)}至${formatNumber(last)}，变化${formatPct(change)}`;
  const pointText = points.map((point) => `${point.x},${point.y}`).join(" ");
  const end = points.at(-1);
  const highPoint = points[values.indexOf(max)];
  const lowPoint = points[values.indexOf(min)];
  const labelPosition = (point, direction) => {
    const anchor = point.x < 30 ? "start" : point.x > width - 30 ? "end" : "middle";
    const x = anchor === "start" ? point.x + 2 : anchor === "end" ? point.x - 2 : point.x;
    const y = direction === "high" ? Math.max(8, point.y - 4) : Math.min(height - 2, point.y + 10);
    return { x: round(x, 2), y: round(y, 2), anchor };
  };
  const highLabel = labelPosition(highPoint, "high");
  const lowLabel = labelPosition(lowPoint, "low");
  const extremeLabels =
    range === 0
      ? `
        <circle class="sparkline-extreme sparkline-high-point" cx="${highPoint.x}" cy="${highPoint.y}" r="2.3"></circle>
        <text class="sparkline-value sparkline-value-flat" x="${highLabel.x}" y="${highLabel.y}" text-anchor="${highLabel.anchor}">高/低 ${escapeHtml(highText)}</text>
      `
      : `
        <circle class="sparkline-extreme sparkline-high-point" cx="${highPoint.x}" cy="${highPoint.y}" r="2.3"></circle>
        <text class="sparkline-value sparkline-value-high" x="${highLabel.x}" y="${highLabel.y}" text-anchor="${highLabel.anchor}">高 ${escapeHtml(highText)}</text>
        <circle class="sparkline-extreme sparkline-low-point" cx="${lowPoint.x}" cy="${lowPoint.y}" r="2.3"></circle>
        <text class="sparkline-value sparkline-value-low" x="${lowLabel.x}" y="${lowLabel.y}" text-anchor="${lowLabel.anchor}">低 ${escapeHtml(lowText)}</text>
      `;

  return `
    <svg class="sparkline sparkline-${tone}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(label)}">
      <title>${escapeHtml(label)}</title>
      <line class="sparkline-guide" x1="${paddingX}" y1="${height / 2}" x2="${width - paddingX}" y2="${height / 2}"></line>
      <polyline points="${pointText}"></polyline>
      <circle class="sparkline-endpoint" cx="${end.x}" cy="${end.y}" r="1.8"></circle>
      ${extremeLabels}
    </svg>
  `;
}

function renderConcepts() {
  const items = topConcepts();
  els.conceptList.innerHTML = items.length
    ? items.map((item, index) => `<span class="tag ${index === 0 ? "amber" : ""}">${escapeHtml(item.tag)} · ${item.count}</span>`).join("")
    : `<span class="muted">暂无概念</span>`;
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
                  <button class="danger-button" data-action="delete" data-stock-id="${stock.id}">删除</button>
                </div>
              </div>
              <div class="mini-stats">
                <div class="mini-stat"><span>最新价</span><strong>${latest ? formatNumber(latest.close) : "-"}</strong></div>
                <div class="mini-stat"><span>今日</span><strong>${latest ? formatPct(latest.changePct) : "-"}</strong></div>
                <div class="mini-stat"><span>添加以来</span><strong>${formatPct(sinceAddedReturn(stock.id, stock.addedAt))}</strong></div>
              </div>
              <div class="stock-workflow-controls">
                <label>
                  <span>状态</span>
                  <select data-stock-status="${stock.id}">
                    ${optionHtml(STOCK_STATUS_OPTIONS, stock.workflowStatus)}
                  </select>
                </label>
                <label>
                  <span>入场策略</span>
                  <select data-stock-strategy="${stock.id}">
                    ${optionHtml(STRATEGY_OPTIONS, stock.strategy)}
                  </select>
                </label>
                <button class="ghost-button" data-action="open-plan" data-stock-id="${stock.id}">制定计划</button>
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
      stock.updatedAt = new Date().toISOString();
      saveState();
      render();
      showToast(stock.active ? "已启用" : "已停用");
    });
  });

  els.stockCards.querySelectorAll("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", async () => {
      const stock = state.stocks.find((item) => item.id === button.dataset.stockId);
      if (!stock) return;
      if (!confirm(`确认删除 ${stock.name} 吗？相关行情、新闻和概念记录也会一起删除。`)) return;
      const syncResult = await deleteStock(stock.id);
      showToast(syncResult === true ? "已删除并同步" : "已删除，等待自动同步");
    });
  });

  els.stockCards.querySelectorAll("[data-action='save-concepts']").forEach((button) => {
    button.addEventListener("click", () => {
      const stock = state.stocks.find((item) => item.id === button.dataset.stockId);
      const input = els.stockCards.querySelector(`[data-concept-input="${button.dataset.stockId}"]`);
      if (!stock || !input) return;
      stock.concepts = parseConceptInput(input.value);
      stock.updatedAt = new Date().toISOString();
      syncConceptSnapshot();
      buildReports(false);
      saveState();
      render();
      showToast("概念已保存");
    });
  });

  els.stockCards.querySelectorAll("[data-stock-status]").forEach((select) => {
    select.addEventListener("change", () => updateStockWorkflow(select.dataset.stockStatus, { workflowStatus: select.value }));
  });

  els.stockCards.querySelectorAll("[data-stock-strategy]").forEach((select) => {
    select.addEventListener("change", () => updateStockWorkflow(select.dataset.stockStrategy, { strategy: select.value }));
  });

  els.stockCards.querySelectorAll("[data-action='open-plan']").forEach((button) => {
    button.addEventListener("click", () => {
      setView("plans");
      setPlanSection("plans");
      showPlanEditor(button.dataset.stockId);
    });
  });
}

function updateStockWorkflow(stockId, changes) {
  const stock = state.stocks.find((item) => item.id === stockId);
  if (!stock) return;
  if (changes.workflowStatus !== undefined) stock.workflowStatus = normalizeWorkflowStatus(changes.workflowStatus);
  if (changes.strategy !== undefined) stock.strategy = normalizeStrategy(changes.strategy);
  stock.updatedAt = new Date().toISOString();
  saveState();
  render();
  showToast("股票状态已保存");
}

function orderedStocks() {
  return [...state.stocks].sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true));
}

function activeOrderedStocks() {
  return orderedStocks().filter((stock) => stock.active);
}

function togglePinnedStock(stockId) {
  const stock = state.stocks.find((item) => item.id === stockId);
  if (!stock) return;
  stock.pinned = stock.pinned !== true;
  stock.updatedAt = new Date().toISOString();
  saveState();
  render();
  showToast(stock.pinned ? "已置顶" : "已取消置顶");
}

async function deleteStock(stockId) {
  const stock = state.stocks.find((item) => item.id === stockId);
  if (stock) {
    state.deletedStocks = dedupeDeletedStocks(
      [
        ...(state.deletedStocks || []),
        {
          id: stock.id,
          code: stock.code,
          market: stock.market,
          deletedAt: new Date().toISOString()
        }
      ]
    );
  }
  state.stocks = state.stocks.filter((stock) => stock.id !== stockId);
  state.prices = state.prices.filter((price) => price.stockId !== stockId);
  state.news = state.news.filter((news) => news.stockId !== stockId);
  state.concepts = state.concepts.filter((concept) => concept.stockId !== stockId);
  state.plans = state.plans.filter((plan) => plan.stockId !== stockId);
  syncConceptSnapshot();
  buildReports(false);
  saveState();
  cancelQueuedSupabaseSync();
  render();
  if (!getSupabaseConfig()) return null;
  updateSupabaseStatus("删除上传中");
  const ok = await runSupabaseSave(currentStateSnapshot);
  if (ok) {
    updateSupabaseStatus(`已删除并同步 ${formatClock(new Date())} · ${stateSummary(state)}`);
  } else {
    updateSupabaseStatus("删除已保留，自动同步稍后重试");
    queueSupabaseSync(AUTO_SYNC_RETRY_MS);
  }
  return ok;
}

function activePlanDate() {
  return formatDate(nextTradingDay(new Date()));
}

function planForStock(stockId, date = activePlanDate()) {
  return state.plans
    .filter((plan) => plan.stockId === stockId && plan.date === date)
    .sort((a, b) => timestampValue(b.updatedAt) - timestampValue(a.updatedAt))[0] || null;
}

function renderPlanWorkspace() {
  if (!els.planStock) return;
  const date = activePlanDate();
  els.planDateLabel.textContent = `${formatDateWithWeekday(parseLocalDate(date))} · 下一交易日`;
  renderStockSelect(els.planStock);
  renderStockSelect(els.tradeStock);

  const plans = state.plans
    .filter((plan) => plan.date === date)
    .sort((a, b) => {
      const aStock = state.stocks.find((stock) => stock.id === a.stockId);
      const bStock = state.stocks.find((stock) => stock.id === b.stockId);
      return workflowStatusRank(aStock?.workflowStatus) - workflowStatusRank(bStock?.workflowStatus);
    });

  const totalPosition = plans.reduce((sum, plan) => sum + Number(plan.positionPct || 0), 0);
  const maxTotalPosition = normalizeRiskSettings(state.riskSettings).maxTotalPositionPct;
  const marketRiskPlans = plans.filter((plan) => {
    const latest = latestPrice(plan.stockId);
    return ["risk", "caution"].includes(planDecisionState(plan, latest).tone);
  });
  const missingPositionPlans = plans.filter((plan) => plan.positionPct === null);
  const reviewIds = new Set([...marketRiskPlans, ...missingPositionPlans].map((plan) => plan.id));
  const positionLimitExceeded = totalPosition > maxTotalPosition;
  const reviewCount = reviewIds.size + (positionLimitExceeded ? 1 : 0);
  els.planOverviewCount.textContent = plans.length;
  els.planOverviewPosition.textContent = `${round(totalPosition, 1)}%`;
  els.planOverviewPosition.className = totalPosition > maxTotalPosition ? "negative" : "";
  els.planOverviewRiskCount.textContent = reviewCount;
  els.planOverviewRiskCount.className = reviewCount ? "negative" : "";
  els.planRiskSummary.textContent = plans.length
    ? reviewCount
      ? [
          positionLimitExceeded ? `计划总仓位 ${round(totalPosition, 1)}% 超过上限 ${round(maxTotalPosition, 1)}%` : "",
          marketRiskPlans.length ? `${marketRiskPlans.length}只行情触发风险` : "",
          missingPositionPlans.length ? `${missingPositionPlans.length}只未设置仓位` : ""
        ].filter(Boolean).join("；")
      : "明日计划完整，盘中按预设价格和失效条件执行"
    : "尚未制定明日计划";
  els.planRiskSummary.classList.toggle("has-risk", reviewCount > 0);

  els.planList.innerHTML = plans.length
    ? plans
        .map((plan) => {
          const stock = state.stocks.find((item) => item.id === plan.stockId);
          if (!stock) return "";
          const latest = latestPrice(stock.id);
          const decision = planDecisionState(plan, latest);
          const rewardRisk = planRewardRisk(plan);
          return `
            <article class="plan-card">
              <div class="plan-card-head">
                <div>
                  <strong>${escapeHtml(stock.name)}</strong>
                  <span>${stock.market}${stock.code} · 入场：${escapeHtml(strategyLabel(plan.strategy))}</span>
                </div>
                <span class="plan-state plan-state-${decision.tone}">${escapeHtml(decision.label)}</span>
              </div>
              <div class="plan-level-grid">
                <div><span>最新价</span><strong>${latest ? formatNumber(latest.close) : "-"}</strong></div>
                <div><span>买入区</span><strong>${formatPlanEntry(plan)}</strong></div>
                <div><span>失效价</span><strong>${formatOptionalPrice(plan.invalidation)}</strong></div>
                <div><span>目标</span><strong>${formatPlanTargets(plan)}</strong></div>
                <div><span>计划仓位</span><strong>${plan.positionPct === null ? "-" : `${formatNumber(plan.positionPct)}%`}</strong></div>
                <div><span>盈亏结构</span><strong>${rewardRisk}</strong></div>
              </div>
              <div class="plan-rule-summary">
                <span>买入：${escapeHtml(entryLogicLabel(plan.entryLogic))}</span>
                <span>不交易 ${plan.noTradeConditions.length} 项</span>
                <span>退出：${escapeHtml(exitLogicLabel(plan.exitLogic))}</span>
              </div>
              ${plan.note ? `<p class="plan-note">${escapeHtml(plan.note)}</p>` : ""}
              ${renderPlanExitSummary(plan)}
              <div class="plan-card-actions">
                <button class="ghost-button" data-action="edit-plan" data-plan-id="${plan.id}">编辑</button>
                <button class="danger-text-button" data-action="delete-plan" data-plan-id="${plan.id}">删除</button>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state inline-empty show">尚未制定下一交易日计划</div>`;

  els.planList.querySelectorAll("[data-action='edit-plan']").forEach((button) => {
    button.addEventListener("click", () => {
      const plan = state.plans.find((item) => item.id === button.dataset.planId);
      if (plan) showPlanEditor(plan.stockId, plan.id);
    });
  });

  els.planList.querySelectorAll("[data-action='delete-plan']").forEach((button) => {
    button.addEventListener("click", () => {
      const plan = state.plans.find((item) => item.id === button.dataset.planId);
      if (!plan || !confirm("确认删除这条次日计划吗？")) return;
      state.plans = state.plans.filter((item) => item.id !== plan.id);
      if (els.savePlanBtn.dataset.planId === plan.id) planEditorOpen = false;
      saveState();
      render();
      showToast("计划已删除");
    });
  });

  renderPlanEditorVisibility();
  renderPlanContext(els.planStock.value);
  setPlanSection(activePlanSection);
}

function renderStockSelect(select) {
  if (!select) return;
  const current = select.value;
  const selectableStocks = activeOrderedStocks();
  select.innerHTML = selectableStocks.length
    ? selectableStocks
        .map((stock) => `<option value="${stock.id}">${escapeHtml(stock.name)} · ${stock.market}${stock.code}</option>`)
        .join("")
    : `<option value="">暂无股票</option>`;
  if (selectableStocks.some((stock) => stock.id === current)) select.value = current;
}

function loadPlanIntoForm(stockId, planId = "") {
  const plan = state.plans.find((item) => item.id === planId) || planForStock(stockId);
  const riskSettings = normalizeRiskSettings(state.riskSettings);
  els.planStock.value = stockId;
  const stock = state.stocks.find((item) => item.id === stockId);
  els.planStrategy.value = plan?.strategy || stock?.strategy || "";
  els.planEntryLow.value = plan?.entryLow ?? "";
  els.planEntryHigh.value = plan?.entryHigh ?? "";
  els.planInvalidation.value = plan?.invalidation ?? "";
  els.planTarget1.value = plan?.target1 ?? "";
  els.planTarget2.value = plan?.target2 ?? "";
  els.planPositionPct.value = plan?.positionPct ?? "";
  els.planRiskPct.value = riskSettings.riskPerTradePct;
  els.planMaxPositionPct.value = riskSettings.maxPositionPct;
  els.planMaxTotalPositionPct.value = riskSettings.maxTotalPositionPct;
  els.planEntryLogic.value = plan?.entryLogic || defaultEntryLogicForStrategy(plan?.strategy || stock?.strategy);
  setCheckedValues(els.planNoTradeConditions, plan?.noTradeConditions || defaultNoTradeConditions(plan?.strategy || stock?.strategy));
  els.planNote.value = plan?.note || "";
  els.planInvalidationTrigger.value = plan?.invalidationTrigger || "close";
  els.planTarget1SellPct.value = plan?.target1SellPct ?? 30;
  els.planTarget2SellPct.value = plan?.target2SellPct ?? 30;
  els.planTrailingRule.value = plan?.trailingRule || "structure";
  els.planExitLogic.value = plan?.exitLogic || "invalidation";
  setCheckedValues(els.planExitConditions, plan?.exitConditions || ["invalidation", "target1", "target2"]);
  els.planMaxHoldDays.value = plan?.maxHoldDays ?? "";
  els.planExitNote.value = plan?.exitNote || "";
  els.savePlanBtn.dataset.planId = plan?.id || "";
  els.savePlanBtn.textContent = plan ? "更新计划" : "保存计划";
  updateExitRemainder();
  updateConditionSummaries();
  updatePlanSuggestionPrompt();
  renderPlanContext(stockId);
}

function showPlanEditor(stockId = "", planId = "") {
  planEditorOpen = true;
  setPlanSection("plans");
  renderPlanEditorVisibility();

  let selectedStockId = stockId;
  if (!selectedStockId) {
    const available = activeOrderedStocks();
    selectedStockId = available.find((stock) => !planForStock(stock.id))?.id || available[0]?.id || "";
  }
  if (selectedStockId) loadPlanIntoForm(selectedStockId, planId);
  els.planEditorPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hidePlanEditor() {
  planEditorOpen = false;
  renderPlanEditorVisibility();
}

function togglePlanStockAdd() {
  const willOpen = els.planStockAddPanel.hidden;
  els.planStockAddPanel.hidden = !willOpen;
  els.togglePlanStockAddBtn.textContent = willOpen ? "收起添加" : "＋ 添加新股票";
  if (willOpen) els.planStockQuery.focus();
}

function handlePlanStockQueryInput() {
  clearTimeout(planStockLookupTimer);
  planResolvedStock = null;
  planResolvedQuery = "";
  const query = els.planStockQuery.value.trim();
  if (!query) {
    updatePlanStockAddPreview("输入代码或名称后识别", "muted");
    return;
  }

  const code = cleanCode(query);
  const market = inferMarket(code);
  if (code.length === 6 && market) {
    const name = lookupStockNameFallback(code, market);
    updatePlanStockAddPreview(
      `${marketName(market)} · ${market}${code}${name ? ` · ${name}` : " · 正在识别名称"}`,
      name ? "ready" : "loading"
    );
  } else {
    const local = lookupStockByNameFallback(query);
    updatePlanStockAddPreview(
      local ? `${marketName(local.market)} · ${local.market}${local.code} · ${local.name}` : "正在按名称识别...",
      local ? "ready" : "loading"
    );
  }

  planStockLookupTimer = setTimeout(() => resolvePlanStockQuery(), STOCK_LOOKUP_DELAY_MS);
}

async function resolvePlanStockQuery() {
  const query = els.planStockQuery.value.trim();
  if (!query) return null;
  if (planResolvedStock && planResolvedQuery === query) return planResolvedStock;

  const requestId = ++planStockLookupRequestId;
  let match = null;
  const code = cleanCode(query);
  const market = inferMarket(code);

  if (code.length === 6 && market) {
    const existing = state.stocks.find((stock) => stock.code === code && stock.market === market);
    const fallbackName = existing?.name || lookupStockNameFallback(code, market);
    if (fallbackName) {
      match = { code, market, name: fallbackName };
    } else {
      const quote = await fetchStockQuote(code, market).catch(() => null);
      if (quote?.name) match = { code, market, name: quote.name };
    }
  } else if (query.length >= 2) {
    const local = lookupStockByNameFallback(query);
    match = local
      ? { code: cleanCode(local.code), market: local.market || inferMarket(local.code), name: local.name }
      : await fetchStockSearch(query).catch(() => null);
  }

  if (requestId !== planStockLookupRequestId || els.planStockQuery.value.trim() !== query) return null;
  if (!match?.name || cleanCode(match.code).length !== 6 || !match.market) {
    planResolvedStock = null;
    planResolvedQuery = "";
    updatePlanStockAddPreview("未识别，请检查代码或名称", "error");
    return null;
  }

  planResolvedStock = {
    code: cleanCode(match.code),
    market: match.market || inferMarket(match.code),
    name: String(match.name).trim()
  };
  planResolvedQuery = query;
  const exists = state.stocks.some(
    (stock) => stock.code === planResolvedStock.code && stock.market === planResolvedStock.market
  );
  updatePlanStockAddPreview(
    `${marketName(planResolvedStock.market)} · ${planResolvedStock.market}${planResolvedStock.code} · ${planResolvedStock.name}${exists ? " · 已在股票池" : ""}`,
    "ready"
  );
  return planResolvedStock;
}

function updatePlanStockAddPreview(text, tone = "muted") {
  els.planStockAddPreview.textContent = text;
  els.planStockAddPreview.className =
    tone === "error" ? "negative" : tone === "ready" ? "positive" : tone === "loading" ? "plan-preview-loading" : "muted";
}

async function addPlanStockFromPlan() {
  const query = els.planStockQuery.value.trim();
  if (!query) {
    showToast("请输入股票代码或名称");
    return;
  }

  els.addPlanStockBtn.disabled = true;
  els.addPlanStockBtn.textContent = "识别中";
  const identity =
    planResolvedStock && planResolvedQuery === query ? planResolvedStock : await resolvePlanStockQuery();
  if (!identity) {
    els.addPlanStockBtn.disabled = false;
    els.addPlanStockBtn.textContent = "添加并选中";
    showToast("股票识别失败，请检查输入");
    return;
  }

  const now = new Date();
  const concepts = parseConceptInput(els.planStockConcepts.value);
  let stock = state.stocks.find((item) => item.code === identity.code && item.market === identity.market);
  const existed = Boolean(stock);

  if (stock) {
    stock.name = identity.name || stock.name;
    stock.active = true;
    stock.workflowStatus = "planned";
    stock.concepts = normalizeConceptList([...(stock.concepts || []), ...concepts]);
    stock.updatedAt = now.toISOString();
  } else {
    stock = {
      id: makeId(),
      code: identity.code,
      name: identity.name,
      market: identity.market,
      concepts,
      createdAt: now.toISOString(),
      addedAt: formatDate(now),
      updatedAt: now.toISOString(),
      active: true,
      pinned: false,
      workflowStatus: "planned",
      strategy: ""
    };
    state.deletedStocks = (state.deletedStocks || []).filter(
      (record) => !deleteRecordAppliesToStock(record, stock)
    );
    state.stocks.unshift(stock);
  }

  const quote = await fetchStockQuote(stock.code, stock.market).catch(() => null);
  if (quote?.close && quote.changePct !== null) {
    if (quote.name) stock.name = quote.name;
    upsertPrice({
      stockId: stock.id,
      date: quote.date || formatDate(now),
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: round(quote.close, 2),
      volume: quote.volume,
      amount: quote.amount,
      changePct: round(quote.changePct, 2)
    });
  }

  syncConceptSnapshot();
  planEditorOpen = true;
  saveState();
  resetPlanStockAddForm();
  render();
  setView("plans");
  setPlanSection("plans");
  showPlanEditor(stock.id);
  els.addPlanStockBtn.disabled = false;
  els.addPlanStockBtn.textContent = "添加并选中";
  showToast(existed ? "股票已选中并设为明日计划" : "已加入股票池并选中");
}

function resetPlanStockAddForm() {
  clearTimeout(planStockLookupTimer);
  planResolvedStock = null;
  planResolvedQuery = "";
  els.planStockQuery.value = "";
  els.planStockConcepts.value = "";
  els.planStockAddPanel.hidden = true;
  els.togglePlanStockAddBtn.textContent = "＋ 添加新股票";
  updatePlanStockAddPreview("输入代码或名称后识别", "muted");
}

function renderPlanEditorVisibility() {
  if (!els.planEditorPanel) return;
  els.planEditorPanel.hidden = !planEditorOpen;
}

function renderPlanContext(stockId) {
  if (!els.planContextName) return;
  const stock = state.stocks.find((item) => item.id === stockId);
  const latest = stock ? latestPrice(stock.id) : null;
  const risk = stock ? riskSuggestionFor(stock) : null;
  els.planContextName.textContent = stock ? `${stock.name} · ${stock.market}${stock.code}` : "-";
  els.planContextPrice.textContent = latest ? formatNumber(latest.close) : "-";
  els.planContextChange.textContent = latest ? formatPct(latest.changePct) : "-";
  els.planContextChange.className = latest ? (Number(latest.changePct) >= 0 ? "positive" : "negative") : "";
  els.planContextRisk.textContent = risk ? risk.label : "-";
  els.planContextRisk.className = risk ? `plan-state-${risk.tone}` : "";
  els.planContextRisk.title = risk?.reason || "";
}

function updatePlanSuggestionPrompt() {
  if (!els.planSuggestionResult) return;
  const stock = state.stocks.find((item) => item.id === els.planStock.value);
  const strategy = normalizeStrategy(els.planStrategy.value);
  if (!stock) {
    els.planSuggestionResult.textContent = "请先选择股票。";
    return;
  }
  if (!strategy) {
    els.planSuggestionResult.textContent = "请选择入场策略，再生成对应的价格和仓位建议。";
    return;
  }
  const historyCount = state.prices.filter(
    (item) => item.stockId === stock.id && Number.isFinite(Number(item.close))
  ).length;
  els.planSuggestionResult.textContent =
    `${stock.name}当前有 ${historyCount} 个交易日记录；点击“生成建议”后只会填入表单，不会自动交易。`;
}

function applySuggestedPlan() {
  const stock = state.stocks.find((item) => item.id === els.planStock.value);
  const strategy = normalizeStrategy(els.planStrategy.value);
  if (!stock) {
    showToast("请先选择股票");
    return;
  }
  if (!strategy) {
    showToast("请先选择入场策略");
    return;
  }

  const settings = normalizeRiskSettings({
    riskPerTradePct: els.planRiskPct.value,
    maxPositionPct: els.planMaxPositionPct.value,
    maxTotalPositionPct: els.planMaxTotalPositionPct.value
  });
  const suggestion = suggestedPlanFor(stock, strategy, settings);
  if (!suggestion.ok) {
    els.planSuggestionResult.innerHTML = `<strong class="negative">暂时无法计算</strong><span>${escapeHtml(suggestion.reason)}</span>`;
    showToast(suggestion.reason);
    return;
  }

  els.planEntryLow.value = formatNumber(suggestion.entryLow);
  els.planEntryHigh.value = formatNumber(suggestion.entryHigh);
  els.planInvalidation.value = formatNumber(suggestion.invalidation);
  els.planTarget1.value = formatNumber(suggestion.target1);
  els.planTarget2.value = formatNumber(suggestion.target2);
  els.planPositionPct.value = suggestion.positionPct === null ? "" : round(suggestion.positionPct, 1);
  els.planEntryLogic.value = suggestion.entryLogic;
  setCheckedValues(els.planNoTradeConditions, suggestion.noTradeConditions);
  els.planExitLogic.value = suggestion.exitLogic;
  setCheckedValues(els.planExitConditions, suggestion.exitConditions);
  els.planInvalidationTrigger.value = suggestion.invalidationTrigger;
  els.planTrailingRule.value = suggestion.trailingRule;
  els.planMaxHoldDays.value = suggestion.maxHoldDays;
  updateConditionSummaries();

  const positionText = suggestion.positionPct === null ? "仓位待手动确认" : `建议仓位 ${round(suggestion.positionPct, 1)}%`;
  els.planSuggestionResult.innerHTML = `
    <strong class="suggestion-confidence confidence-${suggestion.confidence}">
      ${escapeHtml(suggestion.confidenceLabel)}
    </strong>
    <span>买入 ${formatNumber(suggestion.entryLow)}–${formatNumber(suggestion.entryHigh)}，失效 ${formatNumber(suggestion.invalidation)}，目标 ${formatNumber(suggestion.target1)} / ${formatNumber(suggestion.target2)}，${escapeHtml(positionText)}。</span>
    <small>${escapeHtml(suggestion.basis)}</small>
  `;
  showToast("建议参数已填入，请确认后保存");
}

function suggestedPlanFor(stock, strategy, settings) {
  const rawHistory = state.prices
    .filter((item) => item.stockId === stock.id && Number.isFinite(Number(item.close)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-60);
  let segmentStart = 0;
  for (let index = 1; index < rawHistory.length; index += 1) {
    const previous = Number(rawHistory[index - 1].close);
    const current = Number(rawHistory[index].close);
    const change = previous > 0 ? Math.abs(current / previous - 1) : 1;
    if (change > 0.35) segmentStart = index;
  }
  const history = rawHistory.slice(segmentStart);
  if (history.length < 5) {
    const reason = segmentStart > 0
      ? "检测到历史价格口径异常，后台补齐统一口径的日线后再生成建议"
      : `目前只有 ${history.length} 个交易日数据，至少积累 5 日后再生成建议`;
    return { ok: false, reason };
  }

  const closes = history.map((item) => Number(item.close));
  const latest = closes.at(-1);
  const minClose = Math.min(...closes);
  const maxClose = Math.max(...closes);
  if (minClose <= 0 || maxClose / minClose > 4) {
    return {
      ok: false,
      reason: "检测到历史价格跨度异常，后台补齐统一口径的日线后再生成建议"
    };
  }
  const completeBars = history.filter(
    (item) => [item.high, item.low, item.close].every((value) => Number.isFinite(Number(value)))
  );
  const ranges = history.slice(1).map((item, index) => {
    const previousClose = Number(history[index].close);
    const high = Number(item.high);
    const low = Number(item.low);
    if (Number.isFinite(high) && Number.isFinite(low)) {
      return Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
    }
    return Math.abs(Number(item.close) - previousClose);
  });
  const atr = Math.max(average(ranges.slice(-14)), latest * 0.005);
  if (atr / latest > 0.25) {
    return {
      ok: false,
      reason: "检测到历史波动数据异常，后台更新日线后再生成建议"
    };
  }
  const referenceBars = history.slice(0, -1).slice(-20);
  const referenceHigh = Math.max(
    ...referenceBars.map((item) => Number.isFinite(Number(item.high)) ? Number(item.high) : Number(item.close))
  );
  const referenceLow = Math.min(
    ...referenceBars.map((item) => Number.isFinite(Number(item.low)) ? Number(item.low) : Number(item.close))
  );
  const ma10 = average(closes.slice(-10));
  const ma20 = average(closes.slice(-20));
  let entryLow;
  let entryHigh;
  let invalidation;

  if (strategy === "breakout") {
    entryLow = referenceHigh;
    entryHigh = referenceHigh + atr * 0.3;
    invalidation = referenceHigh - atr * 0.8;
  } else if (strategy === "breakout_retest") {
    entryLow = referenceHigh - atr * 0.25;
    entryHigh = referenceHigh + atr * 0.15;
    invalidation = referenceHigh - atr * 0.9;
  } else if (strategy === "trend_pullback") {
    const support = closes.length >= 10 ? ma10 : ma20;
    entryLow = support - atr * 0.25;
    entryHigh = support + atr * 0.25;
    invalidation = Math.max(referenceLow - atr * 0.2, support - atr * 1.2);
  } else if (strategy === "support_rebound") {
    entryLow = referenceLow + atr * 0.1;
    entryHigh = referenceLow + atr * 0.5;
    invalidation = referenceLow - atr * 0.35;
  } else if (strategy === "rebound") {
    entryLow = latest - atr * 0.2;
    entryHigh = latest + atr * 0.2;
    invalidation = Math.max(referenceLow - atr * 0.25, latest - atr * 1.4);
  } else {
    entryLow = latest - atr * 0.3;
    entryHigh = latest + atr * 0.3;
    invalidation = latest - atr * 1.2;
  }

  entryLow = Math.max(0.01, entryLow);
  entryHigh = Math.max(entryLow, entryHigh);
  if (invalidation >= entryLow) invalidation = entryLow - atr * 0.8;
  invalidation = Math.max(0.01, invalidation);
  const entryMid = (entryLow + entryHigh) / 2;
  const risk = Math.max(0.01, entryMid - invalidation);
  const target1 = entryMid + risk * 1.5;
  const target2 = entryMid + risk * 2.5;
  const stopDistancePct = (risk / entryMid) * 100;
  const otherPlanPosition = state.plans
    .filter((plan) => plan.date === activePlanDate() && plan.stockId !== stock.id)
    .reduce((sum, plan) => sum + Number(plan.positionPct || 0), 0);
  const totalCapacity = Math.max(0, settings.maxTotalPositionPct - otherPlanPosition);
  const riskSizedPosition = stopDistancePct > 0 ? (settings.riskPerTradePct / stopDistancePct) * 100 : null;
  const positionPct = riskSizedPosition === null || totalCapacity <= 0
    ? null
    : Math.max(1, Math.min(riskSizedPosition, settings.maxPositionPct, totalCapacity));
  const confidence = ["event", "custom"].includes(strategy)
    ? "low"
    : completeBars.length >= 20 && history.length >= 30
      ? "high"
      : history.length >= 20
        ? "medium"
        : "low";
  const confidenceLabel = {
    high: "较高置信度",
    medium: "中等置信度",
    low: "低置信度"
  }[confidence];
  const dataBasis = completeBars.length >= 14
    ? `${history.length}日日线与 ATR14`
    : `${history.length}日收盘波动估算`;
  const noTradeConditions = defaultNoTradeConditions(strategy);
  if (confidence === "low" && !noTradeConditions.includes("data_stale")) noTradeConditions.push("data_stale");
  if (positionPct === null && !noTradeConditions.includes("position_limit")) noTradeConditions.push("position_limit");

  return {
    ok: true,
    entryLow: round(entryLow, 2),
    entryHigh: round(entryHigh, 2),
    invalidation: round(invalidation, 2),
    target1: round(target1, 2),
    target2: round(target2, 2),
    positionPct,
    confidence,
    confidenceLabel,
    basis: `${strategyLabel(strategy)}；基于${dataBasis}；第一目标约 1.5R，第二目标约 2.5R。`,
    entryLogic: defaultEntryLogicForStrategy(strategy),
    noTradeConditions,
    exitLogic: "invalidation",
    exitConditions: ["invalidation", "target1", "target2", strategy === "event" ? "event_failed" : "structure_low"],
    invalidationTrigger: strategy === "event" ? "intraday" : "close",
    trailingRule: strategy === "breakout" || strategy === "breakout_retest" ? "breakeven" : "structure",
    maxHoldDays: strategy === "event" || strategy === "rebound" ? 3 : 5
  };
}

function defaultEntryLogicForStrategy(strategy) {
  return {
    breakout: "breakout_volume",
    breakout_retest: "breakout_retest",
    trend_pullback: "ma_support",
    support_rebound: "structure_support",
    rebound: "reversal_confirm",
    event: "event_confirm",
    custom: "manual"
  }[normalizeStrategy(strategy)] || "";
}

function defaultNoTradeConditions(strategy) {
  if (!normalizeStrategy(strategy)) return [];
  const common = ["above_entry", "below_invalidation", "sector_weak", "rr_low"];
  if (strategy === "breakout") common.push("volume_unconfirmed");
  if (strategy === "event") common.push("event_unconfirmed", "volatility_abnormal");
  return common;
}

function checkedValues(container) {
  return [...container.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value);
}

function setCheckedValues(container, values) {
  const selected = new Set(values || []);
  container.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function updateConditionSummaries() {
  const noTradeCount = checkedValues(els.planNoTradeConditions).length;
  const exitCount = checkedValues(els.planExitConditions).length;
  els.planNoTradeSummary.textContent = noTradeCount ? `已选 ${noTradeCount} 项` : "未选择";
  els.planExitConditionSummary.textContent = exitCount ? `已选 ${exitCount} 项` : "未选择";
}

function resetPlanForm() {
  [
    els.planEntryLow,
    els.planEntryHigh,
    els.planInvalidation,
    els.planTarget1,
    els.planTarget2,
    els.planPositionPct,
    els.planNote,
    els.planMaxHoldDays,
    els.planExitNote
  ].forEach((input) => {
    input.value = "";
  });
  els.planStrategy.value = "";
  els.planEntryLogic.value = "";
  setCheckedValues(els.planNoTradeConditions, []);
  els.planInvalidationTrigger.value = "close";
  els.planTarget1SellPct.value = "30";
  els.planTarget2SellPct.value = "30";
  els.planTrailingRule.value = "structure";
  els.planExitLogic.value = "invalidation";
  setCheckedValues(els.planExitConditions, ["invalidation", "target1", "target2"]);
  els.savePlanBtn.dataset.planId = "";
  els.savePlanBtn.textContent = "保存计划";
  updateExitRemainder();
  updateConditionSummaries();
  updatePlanSuggestionPrompt();
}

function savePlanFromForm() {
  const stock = state.stocks.find((item) => item.id === els.planStock.value);
  if (!stock) {
    showToast("请先选择股票");
    return;
  }
  let entryLow = finiteNumberOrNull(els.planEntryLow.value);
  let entryHigh = finiteNumberOrNull(els.planEntryHigh.value);
  const invalidation = finiteNumberOrNull(els.planInvalidation.value);
  const target1 = finiteNumberOrNull(els.planTarget1.value);
  const target2 = finiteNumberOrNull(els.planTarget2.value);
  const positionPct = finiteNumberOrNull(els.planPositionPct.value);
  const target1SellPct = finiteNumberOrNull(els.planTarget1SellPct.value) ?? 0;
  const target2SellPct = finiteNumberOrNull(els.planTarget2SellPct.value) ?? 0;
  const maxHoldDays = finiteNumberOrNull(els.planMaxHoldDays.value);
  const riskPerTradePct = finiteNumberOrNull(els.planRiskPct.value);
  const maxPositionPct = finiteNumberOrNull(els.planMaxPositionPct.value);
  const maxTotalPositionPct = finiteNumberOrNull(els.planMaxTotalPositionPct.value);

  if (entryLow === null && entryHigh === null) {
    showToast("请填写计划买入价格");
    return;
  }
  if (entryLow === null) entryLow = entryHigh;
  if (entryHigh === null) entryHigh = entryLow;
  if (entryHigh < entryLow) [entryLow, entryHigh] = [entryHigh, entryLow];
  if (invalidation === null || invalidation <= 0) {
    showToast("请填写策略失效价");
    return;
  }
  if (invalidation >= entryHigh) {
    showToast("做多计划的失效价应低于买入区");
    return;
  }
  if (positionPct !== null && (positionPct <= 0 || positionPct > 100)) {
    showToast("计划仓位应在 0 至 100% 之间");
    return;
  }
  if ([target1SellPct, target2SellPct].some((value) => value < 0 || value > 100)) {
    showToast("每档卖出比例应在 0 至 100% 之间");
    return;
  }
  if (target1SellPct + target2SellPct > 100) {
    showToast("两档卖出比例合计不能超过 100%");
    return;
  }
  if (target1SellPct > 0 && target1 === null) {
    showToast("设置第一目标卖出比例时，请填写第一目标价");
    return;
  }
  if (target2SellPct > 0 && target2 === null) {
    showToast("设置第二目标卖出比例时，请填写第二目标价");
    return;
  }
  if (target1 !== null && target1 <= entryHigh) {
    showToast("第一目标价应高于计划买入区");
    return;
  }
  if (target2 !== null && (target1 === null || target2 <= target1)) {
    showToast("第二目标价应高于第一目标价");
    return;
  }
  if (maxHoldDays !== null && (!Number.isInteger(maxHoldDays) || maxHoldDays < 1 || maxHoldDays > 60)) {
    showToast("最长持有天数应为 1 至 60 的整数");
    return;
  }
  if (riskPerTradePct === null || riskPerTradePct <= 0 || riskPerTradePct > 5) {
    showToast("单笔风险上限应在 0 至 5% 之间");
    return;
  }
  if (maxPositionPct === null || maxPositionPct <= 0 || maxPositionPct > 100) {
    showToast("单票仓位上限应在 0 至 100% 之间");
    return;
  }
  if (maxTotalPositionPct === null || maxTotalPositionPct <= 0 || maxTotalPositionPct > 100) {
    showToast("计划总仓位上限应在 0 至 100% 之间");
    return;
  }

  const now = new Date().toISOString();
  const existing = state.plans.find((item) => item.id === els.savePlanBtn.dataset.planId) || planForStock(stock.id);
  const plan = normalizePlan({
    id: existing?.id || `${stock.id}-${activePlanDate()}`,
    stockId: stock.id,
    date: activePlanDate(),
    strategy: els.planStrategy.value || stock.strategy,
    entryLow,
    entryHigh,
    invalidation,
    target1,
    target2,
    positionPct,
    entryLogic: els.planEntryLogic.value,
    noTradeConditions: checkedValues(els.planNoTradeConditions),
    note: els.planNote.value,
    invalidationTrigger: els.planInvalidationTrigger.value,
    target1SellPct,
    target2SellPct,
    trailingRule: els.planTrailingRule.value,
    exitLogic: els.planExitLogic.value,
    exitConditions: checkedValues(els.planExitConditions),
    maxHoldDays,
    exitNote: els.planExitNote.value,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  });
  const index = state.plans.findIndex((item) => item.id === plan.id);
  if (index >= 0) state.plans[index] = plan;
  else state.plans.push(plan);
  state.riskSettings = normalizeRiskSettings({
    riskPerTradePct,
    maxPositionPct,
    maxTotalPositionPct
  });
  stock.workflowStatus = "planned";
  stock.strategy = plan.strategy;
  stock.updatedAt = now;
  saveState();
  resetPlanForm();
  planEditorOpen = false;
  render();
  showToast("次日计划已保存");
}

function planDecisionState(plan, latest) {
  if (!latest || !Number.isFinite(Number(latest.close))) return { tone: "muted", label: "等待行情" };
  const price = Number(latest.close);
  if (plan.invalidation !== null && price <= plan.invalidation) return { tone: "risk", label: "失效复核" };
  if (plan.target2 !== null && price >= plan.target2) {
    return { tone: "positive", label: `达到第二目标 · 卖${formatNumber(plan.target2SellPct)}%` };
  }
  if (plan.target1 !== null && price >= plan.target1) {
    return { tone: "positive", label: `达到第一目标 · 卖${formatNumber(plan.target1SellPct)}%` };
  }
  if (price >= plan.entryLow && price <= plan.entryHigh) return { tone: "ready", label: "进入计划区" };
  if (price > plan.entryHigh) return { tone: "caution", label: "高于计划区" };
  return { tone: "watch", label: "等待计划区" };
}

function formatPlanEntry(plan) {
  if (plan.entryLow === null && plan.entryHigh === null) return "-";
  if (plan.entryLow === plan.entryHigh || plan.entryHigh === null) return formatOptionalPrice(plan.entryLow);
  return `${formatOptionalPrice(plan.entryLow)}–${formatOptionalPrice(plan.entryHigh)}`;
}

function formatPlanTargets(plan) {
  const targets = [plan.target1, plan.target2].filter((value) => value !== null).map(formatOptionalPrice);
  return targets.length ? targets.join(" / ") : "-";
}

function planRemainingPct(plan) {
  return Math.max(0, 100 - Number(plan.target1SellPct || 0) - Number(plan.target2SellPct || 0));
}

function updateExitRemainder() {
  if (!els.planExitRemainder) return;
  const target1Pct = finiteNumberOrNull(els.planTarget1SellPct.value) ?? 0;
  const target2Pct = finiteNumberOrNull(els.planTarget2SellPct.value) ?? 0;
  const remaining = Math.max(0, 100 - target1Pct - target2Pct);
  els.planExitRemainder.textContent =
    target1Pct + target2Pct > 100 ? "卖出比例已超过100%" : `剩余仓位 ${round(remaining, 1)}%`;
  els.planExitRemainder.classList.toggle("negative", target1Pct + target2Pct > 100);
}

function renderPlanExitSummary(plan) {
  const remaining = planRemainingPct(plan);
  const items = [
    `失效：${invalidationTriggerLabel(plan.invalidationTrigger)}`,
    plan.target1 === null ? "第一目标未设" : `T1 ${formatOptionalPrice(plan.target1)}卖${formatNumber(plan.target1SellPct)}%`,
    plan.target2 === null ? "第二目标未设" : `T2 ${formatOptionalPrice(plan.target2)}卖${formatNumber(plan.target2SellPct)}%`,
    `余${formatNumber(remaining)}% · ${trailingRuleLabel(plan.trailingRule)}`,
    plan.maxHoldDays === null ? "持有天数未设" : `${formatNumber(plan.maxHoldDays)}日未启动复核`
  ];
  return `
    <div class="plan-exit-summary">
      <strong>卖出计划 · ${escapeHtml(exitLogicLabel(plan.exitLogic))}</strong>
      <div>${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      ${plan.exitConditions.length ? `<small>${escapeHtml(optionValuesLabel(plan.exitConditions, EXIT_CONDITION_OPTIONS))}</small>` : ""}
      ${plan.exitNote ? `<p>${escapeHtml(plan.exitNote)}</p>` : ""}
    </div>
  `;
}

function formatPlanExitText(plan) {
  const remaining = planRemainingPct(plan);
  const targets = [
    plan.target1 === null ? "" : `T1卖${formatNumber(plan.target1SellPct)}%`,
    plan.target2 === null ? "" : `T2卖${formatNumber(plan.target2SellPct)}%`
  ].filter(Boolean);
  return [
    `退出逻辑：${exitLogicLabel(plan.exitLogic)}`,
    `失效按${invalidationTriggerLabel(plan.invalidationTrigger)}`,
    ...targets,
    `余${formatNumber(remaining)}%按${trailingRuleLabel(plan.trailingRule)}保护`,
    plan.maxHoldDays === null ? "" : `${formatNumber(plan.maxHoldDays)}日未启动复核`
  ].filter(Boolean).join("；");
}

function formatOptionalPrice(value) {
  return value === null || value === undefined ? "-" : formatNumber(value);
}

function planRewardRisk(plan) {
  if (plan.entryLow === null || plan.entryHigh === null || plan.invalidation === null || plan.target1 === null) return "-";
  const entry = (plan.entryLow + plan.entryHigh) / 2;
  const risk = entry - plan.invalidation;
  if (risk <= 0) return "-";
  return `${round((plan.target1 - entry) / risk, 1)}R`;
}

function workflowStatusRank(value) {
  return { holding: 0, planned: 1, watch: 2, closed: 3 }[normalizeWorkflowStatus(value)] ?? 4;
}

function saveTradeLogFromForm() {
  const stock = state.stocks.find((item) => item.id === els.tradeStock.value);
  if (!stock) {
    showToast("请先选择股票");
    return;
  }
  const action = els.tradeAction.value;
  const price = finiteNumberOrNull(els.tradePrice.value);
  const quantity = finiteNumberOrNull(els.tradeQuantity.value);
  if (action !== "skip" && (price === null || price <= 0)) {
    showToast("请填写成交价格");
    return;
  }
  const now = new Date().toISOString();
  state.tradeLogs.push(
    normalizeTradeLog({
      id: makeId(),
      stockId: stock.id,
      stockName: stock.name,
      stockCode: `${stock.market}${stock.code}`,
      date: formatDate(new Date()),
      action,
      price,
      quantity,
      reason: els.tradeReason.value,
      followedPlan: els.tradeFollowedPlan.checked,
      createdAt: now,
      updatedAt: now
    })
  );
  stock.workflowStatus = action === "buy" ? "holding" : action === "sell" ? "closed" : "watch";
  stock.updatedAt = now;
  els.tradePrice.value = "";
  els.tradeQuantity.value = "";
  els.tradeReason.value = "";
  els.tradeFollowedPlan.checked = true;
  saveState();
  render();
  showToast("执行记录已保存");
}

function renderReviewMetrics() {
  if (!els.reviewPlans) return;
  const plans = state.plans.length;
  const executed = state.tradeLogs.filter((item) => item.action === "buy" || item.action === "sell").length;
  const skipped = state.tradeLogs.filter((item) => item.action === "skip").length;
  const discipline = state.tradeLogs.length
    ? (state.tradeLogs.filter((item) => item.followedPlan !== false).length / state.tradeLogs.length) * 100
    : null;
  els.reviewPlans.textContent = plans;
  els.reviewExecuted.textContent = executed;
  els.reviewSkipped.textContent = skipped;
  els.reviewDiscipline.textContent = discipline === null ? "-" : `${round(discipline, 0)}%`;
}

function renderTradeLogs() {
  if (!els.tradeLogList) return;
  const logs = [...state.tradeLogs].sort((a, b) => timestampValue(b.createdAt) - timestampValue(a.createdAt)).slice(0, 30);
  els.tradeLogList.innerHTML = logs.length
    ? logs
        .map(
          (item) => `
            <article class="trade-log-row">
              <span class="trade-action trade-action-${item.action}">${tradeActionLabel(item.action)}</span>
              <div>
                <strong>${escapeHtml(item.stockName || item.stockCode || "已删除股票")}</strong>
                <span>${escapeHtml(item.date)} · ${item.followedPlan ? "遵守计划" : "偏离计划"}</span>
              </div>
              <div class="trade-log-values">
                <strong>${item.price === null ? "-" : formatNumber(item.price)}</strong>
                <span>${item.quantity === null ? "" : `${formatNumber(item.quantity)}股`}</span>
              </div>
              <p>${escapeHtml(item.reason || "未填写原因")}</p>
              <button class="icon-text-button" data-action="delete-trade-log" data-log-id="${item.id}" aria-label="删除执行记录">删除</button>
            </article>
          `
        )
        .join("")
    : `<div class="empty-state inline-empty show">暂无执行记录</div>`;
  els.tradeLogList.querySelectorAll("[data-action='delete-trade-log']").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm("确认删除这条执行记录吗？")) return;
      state.tradeLogs = state.tradeLogs.filter((item) => item.id !== button.dataset.logId);
      saveState();
      render();
      showToast("执行记录已删除");
    });
  });
}

function tradeActionLabel(action) {
  return { buy: "买入", sell: "卖出", skip: "未交易" }[action] || "记录";
}

function captureDailySnapshot(date = formatDate(new Date())) {
  const snapshot = normalizeSnapshot({
    id: date,
    date,
    createdAt: new Date().toISOString(),
    stocks: state.stocks.map((stock) => {
      const latest = latestPrice(stock.id);
      return {
        stockId: stock.id,
        code: `${stock.market}${stock.code}`,
        name: stock.name,
        workflowStatus: stock.workflowStatus,
        strategy: stock.strategy,
        close: latest?.close ?? null,
        changePct: latest?.changePct ?? null,
        priceDate: latest?.date || ""
      };
    })
  });
  const index = state.snapshots.findIndex((item) => item.id === snapshot.id);
  if (index >= 0) state.snapshots[index] = snapshot;
  else state.snapshots.push(snapshot);
  state.snapshots = state.snapshots
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 90);
}

function renderSnapshots() {
  if (!els.snapshotSummary) return;
  const snapshots = [...state.snapshots].sort((a, b) => b.date.localeCompare(a.date));
  els.snapshotSummary.innerHTML = snapshots.length
    ? `<div class="snapshot-overview">
        <strong>已保存 ${snapshots.length} 个交易日</strong>
        <span>最近快照 ${snapshots[0].date}</span>
      </div>
      <div class="snapshot-list">
        ${snapshots
          .slice(0, 6)
          .map((item) => {
            const planned = item.stocks.filter((stock) => stock.workflowStatus === "planned").length;
            const holding = item.stocks.filter((stock) => stock.workflowStatus === "holding").length;
            return `<span>${item.date} · ${item.stocks.length}只 · 计划${planned} · 持仓${holding}</span>`;
          })
          .join("")}
      </div>`
    : `<div class="empty-state inline-empty show">刷新行情后将自动生成当天快照</div>`;
}

function renderReports() {
  const reports = state.reports
    .filter(isScheduledReport)
    .sort((a, b) => `${b.date}${b.type}`.localeCompare(`${a.date}${a.type}`));
  const historyCount = Math.max(0, reports.length - 1);
  els.toggleHistoryReportsBtn.textContent = historyReportsExpanded
    ? `折叠历史（${historyCount}）`
    : `展开历史（${historyCount}）`;
  els.toggleHistoryReportsBtn.disabled = historyCount === 0;
  els.reportList.innerHTML = reports.length
    ? reports
        .map((report, index) => index === 0 ? renderLatestDailyReport(report) : renderHistoricalReport(report))
        .join("")
    : `<div class="panel"><div class="muted">暂无报告</div></div>`;
}

function toggleHistoryReports() {
  historyReportsExpanded = !historyReportsExpanded;
  renderReports();
}

function renderLatestDailyReport(report) {
  const model = buildDailyReportModel(report.date);
  if (!model.rows.length) {
    return `
      <article class="report-card report-card-latest">
        <h3>${escapeHtml(report.type)} · ${escapeHtml(report.date)}</h3>
        <pre>${escapeHtml(report.content)}</pre>
      </article>
    `;
  }

  return `
    <article class="report-card report-card-latest">
      <header class="report-latest-head">
        <div>
          <span>最新日报</span>
          <h3>${escapeHtml(formatDateWithWeekday(parseLocalDate(report.date)))}</h3>
        </div>
        <strong>${model.rows.length}只股票</strong>
      </header>

      <div class="report-summary-grid">
        <div><span>上涨 / 下跌</span><strong>${model.upCount} / ${model.downCount}</strong></div>
        <div><span>平均涨幅</span><strong class="${reportChangeClass(model.average)}">${formatPct(model.average)}</strong></div>
        <div><span>平盘</span><strong>${model.flatCount}</strong></div>
        <div><span>最热概念</span><strong>${model.hotConcept ? `${escapeHtml(model.hotConcept.tag)} · ${model.hotConcept.count}` : "-"}</strong></div>
      </div>

      <section class="report-block">
        <div class="report-block-head">
          <h4>强弱表现</h4>
          <span>按当日涨跌幅</span>
        </div>
        <div class="report-mover-grid">
          ${renderReportMoverGroup("强势前三", model.gainers, "positive")}
          ${renderReportMoverGroup("弱势前三", model.decliners, "negative")}
        </div>
      </section>

      <section class="report-block">
        <div class="report-block-head">
          <h4>重点复盘</h4>
          <span>计划股票与强弱两端，最多10只</span>
        </div>
        <div class="report-focus-list">
          ${model.focusRows.map(renderReportFocusRow).join("")}
        </div>
      </section>

      <section class="report-block">
        <div class="report-block-head">
          <h4>次日计划</h4>
          <span>${model.planRows.length ? `${model.planRows.length}只` : "尚未制定"}</span>
        </div>
        ${
          model.planRows.length
            ? `<div class="report-plan-list">${model.planRows.map(renderReportPlanRow).join("")}</div>`
            : `<div class="report-empty-note">先在下方制定入场与卖出计划，日报会自动汇总到这里。</div>`
        }
      </section>

      <footer class="report-data-note">
        ${
          model.insufficientCount
            ? `${model.insufficientCount}只股票历史记录不足5个交易日，仅统计当日表现。`
            : "全部关注股票均已有至少5个交易日记录。"
        }
      </footer>
    </article>
  `;
}

function renderReportMoverGroup(title, rows, tone) {
  return `
    <div class="report-mover-group">
      <span>${title}</span>
      ${
        rows.length
          ? `<ol>${rows
              .map(
                (row) => `
                  <li>
                    <strong>${escapeHtml(row.stock.name)}</strong>
                    <em class="${tone}">${formatPct(row.ret)}</em>
                    <small>${formatNumber(row.latest.close)}</small>
                  </li>
                `
              )
              .join("")}</ol>`
          : `<div class="muted">暂无</div>`
      }
    </div>
  `;
}

function renderReportFocusRow(row) {
  const risk = riskSuggestionFor(row.stock);
  const concepts = conceptsForStock(row.stock.id).join("、") || "暂无概念";
  return `
    <div class="report-focus-row">
      <div class="report-focus-stock">
        <strong>${escapeHtml(row.stock.name)}</strong>
        <span>${row.stock.market}${row.stock.code} · ${escapeHtml(concepts)}</span>
      </div>
      <div class="report-focus-price">
        <strong>${formatNumber(row.latest.close)}</strong>
        <span class="${reportChangeClass(row.ret)}">${formatPct(row.ret)}</span>
      </div>
      <div class="report-focus-signal signal-${risk.tone}">
        <strong>${escapeHtml(risk.label)}</strong>
        <span>${escapeHtml(compactRiskReason(risk.reason))}</span>
      </div>
    </div>
  `;
}

function renderReportPlanRow({ stock, plan }) {
  return `
    <div class="report-plan-row">
      <div>
        <strong>${escapeHtml(stock.name)}</strong>
        <span>${stock.market}${stock.code} · 入场${escapeHtml(strategyLabel(plan.strategy))}</span>
      </div>
      <span>买入 ${formatPlanEntry(plan)}</span>
      <span>失效 ${formatOptionalPrice(plan.invalidation)}</span>
      <span>目标 ${formatPlanTargets(plan)}</span>
      <span>仓位 ${plan.positionPct === null ? "-" : `${formatNumber(plan.positionPct)}%`}</span>
      <small>${escapeHtml(formatPlanExitText(plan))}</small>
    </div>
  `;
}

function renderHistoricalReport(report) {
  const model = buildDailyReportModel(report.date);
  const meta = model.rows.length
    ? `${model.rows.length}只 · 平均${formatPct(model.average)}`
    : "历史记录";
  return `
    <details class="report-history" ${historyReportsExpanded ? "open" : ""}>
      <summary>
        <div>
          <strong>${escapeHtml(report.type)} · ${escapeHtml(report.date)}</strong>
          <span>${escapeHtml(meta)}</span>
        </div>
        <span>展开全文</span>
      </summary>
      <pre>${escapeHtml(report.content)}</pre>
    </details>
  `;
}

function reportChangeClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "";
  return number > 0 ? "positive" : "negative";
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

function finiteNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteNumberOrDefault(value, fallback) {
  const number = finiteNumberOrNull(value);
  return number === null ? fallback : number;
}

function average(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : 0;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function normalizeOptionValue(value, options, fallback = "") {
  const key = String(value || "");
  return options.some(([option]) => option === key) ? key : fallback;
}

function normalizeOptionValues(values, options) {
  const allowed = new Set(options.map(([value]) => value));
  return [...new Set(Array.isArray(values) ? values : [])].filter((value) => allowed.has(value));
}

function normalizeWorkflowStatus(value) {
  const key = String(value || "");
  return STOCK_STATUS_OPTIONS.some(([option]) => option === key) ? key : "watch";
}

function normalizeStrategy(value) {
  const legacyMap = { pullback: "breakout_retest", trend: "trend_pullback" };
  const key = legacyMap[String(value || "")] || String(value || "");
  return STRATEGY_OPTIONS.some(([option]) => option === key) ? key : "";
}

function normalizeInvalidationTrigger(value) {
  const key = String(value || "");
  return INVALIDATION_TRIGGER_OPTIONS.some(([option]) => option === key) ? key : "close";
}

function normalizeTrailingRule(value) {
  const key = String(value || "");
  return TRAILING_RULE_OPTIONS.some(([option]) => option === key) ? key : "structure";
}

function workflowStatusLabel(value) {
  return STOCK_STATUS_OPTIONS.find(([option]) => option === normalizeWorkflowStatus(value))?.[1] || "观察中";
}

function strategyLabel(value) {
  return STRATEGY_OPTIONS.find(([option]) => option === normalizeStrategy(value))?.[1] || "未设置";
}

function entryLogicLabel(value) {
  return ENTRY_LOGIC_OPTIONS.find(([option]) => option === value)?.[1] || "未设置";
}

function exitLogicLabel(value) {
  return EXIT_LOGIC_OPTIONS.find(([option]) => option === value)?.[1] || "策略失效退出";
}

function optionValuesLabel(values, options) {
  const labels = new Map(options);
  return (values || []).map((value) => labels.get(value)).filter(Boolean).join("、");
}

function invalidationTriggerLabel(value) {
  return INVALIDATION_TRIGGER_OPTIONS.find(([option]) => option === normalizeInvalidationTrigger(value))?.[1] || "收盘确认";
}

function trailingRuleLabel(value) {
  return TRAILING_RULE_OPTIONS.find(([option]) => option === normalizeTrailingRule(value))?.[1] || "近期结构低点";
}

function optionHtml(options, selected) {
  return options
    .map(([value, label]) => `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
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
    state = normalizeState(imported);
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
  state = emptyState();
  saveState();
  render();
  showToast("已清空");
}

async function copyLatestReport() {
  const latest = state.reports
    .filter(isScheduledReport)
    .sort((a, b) => `${b.date}${b.type}`.localeCompare(`${a.date}${a.type}`))[0];
  if (!latest) {
    showToast("暂无报告");
    return;
  }
  const content = buildReportContent(latest.type, latest.date, "daily");
  await navigator.clipboard.writeText(content);
  showToast("报告已复制");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
}

function cleanCode(value) {
  return String(value || "").trim().replace(/[^\d]/g, "").slice(0, 6);
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
  els.marketPreview.textContent = market ? `${marketName(market)} · ${market}${code}` : "输入代码或名称后识别";
  els.marketPreview.classList.toggle("muted", !market);
}

function handleStockCodeInput() {
  updateMarketPreview();
  clearTimeout(stockLookupTimer);

  const code = cleanCode(els.stockCode.value);
  const market = inferMarket(code);
  if (!code || code.length < 6 || !market) {
    els.stockName.value = "";
    els.stockName.placeholder = "输入名称也可自动识别代码";
    return;
  }

  els.stockName.value = lookupStockNameFallback(code, market) || "";
  els.stockName.placeholder = "正在识别...";
  stockLookupTimer = setTimeout(() => refreshStockNameFromCode(), STOCK_LOOKUP_DELAY_MS);
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
    els.stockName.placeholder = "输入名称也可自动识别代码";
    els.marketPreview.textContent = `${marketName(market)} · ${market}${code} · ${name}`;
  } else {
    els.stockName.value = "";
    els.stockName.placeholder = "未识别，请检查代码";
  }
}

function handleStockNameInput() {
  clearTimeout(stockNameLookupTimer);

  const query = els.stockName.value.trim();
  if (!query) return;

  const codeLike = cleanCode(query);
  if (codeLike.length === 6) {
    els.stockCode.value = codeLike;
    handleStockCodeInput();
    return;
  }

  if (query.length < 2) return;

  const localMatch = lookupStockByNameFallback(query);
  if (localMatch && applyStockIdentity(localMatch)) return;

  if (!cleanCode(els.stockCode.value)) {
    els.marketPreview.textContent = "正在按名称识别...";
    els.marketPreview.classList.remove("muted");
  }
  stockNameLookupTimer = setTimeout(() => refreshStockCodeFromName(), STOCK_LOOKUP_DELAY_MS);
}

async function refreshStockCodeFromName(silent = false) {
  const query = els.stockName.value.trim();
  if (!query) return null;

  const codeLike = cleanCode(query);
  if (codeLike.length === 6) {
    els.stockCode.value = codeLike;
    await refreshStockNameFromCode();
    return { code: codeLike, market: inferMarket(codeLike), name: els.stockName.value.trim() };
  }

  if (query.length < 2) return null;

  const localMatch = lookupStockByNameFallback(query);
  if (localMatch && applyStockIdentity(localMatch)) return localMatch;

  const requestId = ++stockNameLookupRequestId;
  if (!silent) {
    els.marketPreview.textContent = "正在按名称识别...";
    els.marketPreview.classList.remove("muted");
  }

  const remoteMatch = await fetchStockSearch(query).catch(() => null);
  if (requestId !== stockNameLookupRequestId || els.stockName.value.trim() !== query) return null;
  if (remoteMatch && applyStockIdentity(remoteMatch)) return remoteMatch;

  if (!cleanCode(els.stockCode.value)) {
    els.marketPreview.textContent = "未识别名称，请输入代码";
    els.marketPreview.classList.add("muted");
  }
  return null;
}

function lookupStockNameFallback(code, market) {
  const existing = state.stocks.find((stock) => stock.code === code && stock.market === market);
  if (existing?.name) return existing.name;
  const sample = sampleStocks.find((stock) => stock.code === code && stock.market === market);
  return sample?.name || "";
}

function lookupStockByNameFallback(value) {
  const query = normalizeStockSearchText(value);
  if (!query) return null;

  const candidates = [...state.stocks, ...sampleStocks].filter((stock) => stock?.name && stock?.code);
  const exact = candidates.find((stock) => normalizeStockSearchText(stock.name) === query);
  if (exact) return exact;

  return candidates.find((stock) => {
    const name = normalizeStockSearchText(stock.name);
    return name.includes(query) || query.includes(name);
  }) || null;
}

function applyStockIdentity(stock) {
  const code = cleanCode(stock?.code || "");
  const market = stock?.market || inferMarket(code);
  if (code.length !== 6 || !market) return false;

  const name = String(stock?.name || "").trim();
  els.stockCode.value = code;
  if (name) els.stockName.value = name;
  els.stockName.placeholder = "输入名称也可自动识别代码";
  els.marketPreview.textContent = `${marketName(market)} · ${market}${code}${name ? ` · ${name}` : ""}`;
  els.marketPreview.classList.remove("muted");
  return true;
}

function normalizeStockSearchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）【】\[\]{}]/g, "");
}

function fetchStockSearch(value) {
  const query = String(value || "").trim();
  if (query.length < 2) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;

    const cleanup = () => {
      script.remove();
      clearTimeout(timer);
      try {
        delete globalThis.v_hint;
      } catch {
        globalThis.v_hint = undefined;
      }
    };

    const done = (callback, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(result);
    };

    const timer = setTimeout(() => done(reject, new Error("Stock search timeout")), 8000);
    globalThis.v_hint = "";
    script.charset = "gbk";
    script.src = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(query)}&t=gp&_=${Date.now()}`;
    script.onload = () => {
      const match = pickStockSearchResult(parseTencentSearch(globalThis.v_hint), query);
      if (match) done(resolve, match);
      else done(reject, new Error("Stock search empty"));
    };
    script.onerror = () => done(reject, new Error("Stock search network error"));
    document.head.appendChild(script);
  });
}

function parseTencentSearch(raw) {
  return String(raw || "")
    .split("^")
    .map((item) => item.split("~"))
    .map(([marketText, code, name]) => {
      const normalizedCode = cleanCode(code || "");
      const market = marketFromSearch(marketText) || inferMarket(normalizedCode);
      return {
        code: normalizedCode,
        market,
        name: String(name || "").trim()
      };
    })
    .filter((item) => item.code.length === 6 && item.market && item.name);
}

function pickStockSearchResult(results, query) {
  const normalizedQuery = normalizeStockSearchText(query);
  const aShareResults = results.filter((item) => item.market === inferMarket(item.code));
  const candidates = aShareResults.length ? aShareResults : results;
  return candidates.find((item) => normalizeStockSearchText(item.name) === normalizedQuery) ||
    candidates.find((item) => normalizeStockSearchText(item.name).includes(normalizedQuery)) ||
    candidates[0] ||
    null;
}

function marketFromSearch(value) {
  const market = String(value || "").trim().toLowerCase();
  if (market === "sh") return "SH";
  if (market === "sz") return "SZ";
  if (market === "bj") return "BJ";
  return "";
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
  const open = numberOrNull(parts[5]);
  const high = numberOrNull(parts[33]);
  const low = numberOrNull(parts[34]);
  const volume = numberOrNull(parts[36]);
  const amount = numberOrNull(parts[37]);
  const changePct = numberOrNull(parts[32]) ??
    (close !== null && previousClose ? round(((close - previousClose) / previousClose) * 100, 2) : null);

  if (!name && close === null) return null;
  return {
    code,
    market,
    name,
    open,
    high,
    low,
    close,
    volume,
    amount,
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

function reportScheduleForDate(date) {
  const day = parseLocalDate(formatDate(date));
  const dayText = formatDate(day);
  if (!isTradingDay(day)) return [];
  return [{ id: `daily-${dayText}`, type: "日报", period: "daily" }];
}

function isScheduledReport(report) {
  return report?.type === "日报" && Boolean(report?.date);
}

function isTradingDay(date) {
  const day = date.getDay();
  return day >= 1 && day <= 5 && !MARKET_HOLIDAYS.has(formatDate(date));
}

function nextTradingDay(date) {
  const probe = parseLocalDate(formatDate(date));
  for (let index = 0; index < 14; index += 1) {
    probe.setDate(probe.getDate() + 1);
    if (isTradingDay(probe)) return probe;
  }
  return probe;
}

function lastTradingDate(date) {
  const probe = parseLocalDate(formatDate(date));
  for (let index = 0; index < 14; index += 1) {
    if (isTradingDay(probe)) return probe;
    probe.setDate(probe.getDate() - 1);
  }
  return probe;
}

function isLastTradingDayOfWeek(date) {
  return isTradingDay(date) && weekKey(nextTradingDay(date)) !== weekKey(date);
}

function isLastTradingDayOfMonth(date) {
  return isTradingDay(date) && nextTradingDay(date).getMonth() !== date.getMonth();
}

function parseLocalDate(value) {
  const [year, month, day] = String(value || "").slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function stateSummary(value) {
  const data = normalizeState(value);
  return `股票${data.stocks.length} 行情${data.prices.length} 计划${data.plans.length}`;
}

function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateWithWeekday(date) {
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const d = new Date(date);
  return `${formatDate(d)} ${weekdays[d.getDay()]}`;
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

function showToast(message, duration = 1800) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), duration);
}
