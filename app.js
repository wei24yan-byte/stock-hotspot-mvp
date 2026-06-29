const STORAGE_KEY = "stock-hotspot-mvp-v1";
const SUPABASE_CONFIG_KEY = "stock-hotspot-supabase-config-v1";
const SUPABASE_STATE_ROW_ID = "default";
const API_STATE_URL = "./api/state";
const STATIC_STATE_URL = "./data/state.json";

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
    "priceForm",
    "priceStock",
    "priceDate",
    "priceClose",
    "priceChange",
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
  els.stockCode.addEventListener("input", updateMarketPreview);
  els.refreshBtn.addEventListener("click", generateDailyUpdate);
  els.sampleBtn.addEventListener("click", seedSamples);
  els.priceForm.addEventListener("submit", saveManualPrice);
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
  return { stocks: [], prices: [], news: [], concepts: [], reports: [] };
}

async function loadState() {
  const fallback = emptyState();
  loadSupabaseForm();

  const cloudState = await loadSupabaseState();
  if (cloudState) return cloudState;

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

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeState(JSON.parse(saved)) : fallback;
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  saveSupabaseState(state);
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

async function saveSupabaseConfig() {
  const url = String(els.supabaseUrl.value || "").trim().replace(/\/+$/, "");
  const anonKey = String(els.supabaseAnonKey.value || "").trim();
  if (!url || !anonKey) {
    showToast("请填写 URL 和 anon key");
    return;
  }
  localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify({ url, anonKey }));
  updateSupabaseStatus("上传中");
  const ok = await saveSupabaseState(state, true);
  updateSupabaseStatus(ok ? "已同步" : "同步失败");
  showToast(ok ? "云端同步已开启" : "云端连接失败");
}

async function pullSupabaseState() {
  updateSupabaseStatus("读取中");
  const cloudState = await loadSupabaseState(true);
  if (!cloudState) {
    updateSupabaseStatus("读取失败");
    showToast("云端暂无数据或连接失败");
    return;
  }
  state = cloudState;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  updateSupabaseStatus("已同步");
  showToast("已从云端读取");
}

async function loadSupabaseState(showErrors = false) {
  const config = getSupabaseConfig();
  if (!config) return null;
  try {
    const url = `${config.url}/rest/v1/app_state?id=eq.${encodeURIComponent(SUPABASE_STATE_ROW_ID)}&select=data`;
    const response = await fetch(url, { headers: supabaseHeaders(config), cache: "no-store" });
    if (!response.ok) throw new Error(`Supabase read failed: ${response.status}`);
    const rows = await response.json();
    const data = rows?.[0]?.data;
    if (!data) return null;
    updateSupabaseStatus("已同步");
    return normalizeState(data);
  } catch (error) {
    if (showErrors) console.warn(error);
    updateSupabaseStatus("云端不可用");
    return null;
  }
}

async function saveSupabaseState(nextState, forceStatus = false) {
  const config = getSupabaseConfig();
  if (!config) return false;
  try {
    const response = await fetch(`${config.url}/rest/v1/app_state?on_conflict=id`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(config),
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify([{ id: SUPABASE_STATE_ROW_ID, data: normalizeState(nextState) }])
    });
    if (!response.ok) throw new Error(`Supabase write failed: ${response.status}`);
    if (forceStatus) updateSupabaseStatus("已同步");
    return true;
  } catch (error) {
    console.warn(error);
    if (forceStatus) updateSupabaseStatus("同步失败");
    return false;
  }
}

function supabaseHeaders(config) {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`
  };
}

function normalizeState(value) {
  const legacyConcepts = Array.isArray(value?.concepts) ? value.concepts : [];
  return {
    stocks: Array.isArray(value?.stocks)
      ? value.stocks.map((stock) => normalizeStock(stock, legacyConcepts))
      : [],
    prices: Array.isArray(value?.prices) ? value.prices : [],
    news: Array.isArray(value?.news) ? value.news : [],
    concepts: legacyConcepts,
    reports: Array.isArray(value?.reports) ? value.reports : []
  };
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
    concepts
  };
}

function setDefaultDates() {
  const today = formatDate(new Date());
  els.todayLabel.textContent = today;
  els.priceDate.value = today;
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

function addStockFromForm() {
  const code = cleanCode(els.stockCode.value);
  const name = els.stockName.value.trim();
  const market = inferMarket(code);
  const concepts = parseConceptInput(els.stockConcepts.value);

  if (!code || !name) {
    showToast("代码和名称都要填写");
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

  state.stocks.unshift({
    id: makeId(),
    code,
    name,
    market,
    concepts,
    addedAt: formatDate(new Date()),
    active: true
  });

  els.stockCode.value = "";
  els.stockName.value = "";
  els.stockConcepts.value = "";
  updateMarketPreview();
  syncConceptSnapshot();
  saveState();
  render();
  showToast("已添加");
}

function seedSamples() {
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
        active: true
      });
      count += 1;
    }
  });
  saveState();
  generateDailyUpdate(false);
  showToast(count ? "样例已载入" : "样例已存在");
}

function generateDailyUpdate(showMessage = true) {
  if (!state.stocks.length) {
    showToast("暂无股票");
    return;
  }

  const today = formatDate(new Date());
  state.stocks.filter((stock) => stock.active).forEach((stock, index) => {
    const last = latestPrice(stock.id);
    const baseClose = last ? last.close : 8 + stableNumber(stock.code, 70);
    const changePct = round(((stableNumber(`${stock.code}-${today}`, 700) - 330) / 100) + index * 0.11, 2);
    const close = Math.max(0.01, round(baseClose * (1 + changePct / 100), 2));
    upsertPrice({ stockId: stock.id, date: today, close, changePct });

    const concept = primaryConcept(stock) || "未填写概念";
    const title = buildNewsTitle(stock, concept, today);
    upsertNews({
      stockId: stock.id,
      date: today,
      title,
      source: "自用聚合",
      url: `https://www.baidu.com/s?wd=${encodeURIComponent(`${stock.name} ${concept}`)}`,
      summary: `${stock.name} 今日关联 ${concept}，需结合公告、板块表现和成交额进一步确认。`
    });
  });

  syncConceptSnapshot();
  buildReports(false);
  saveState();
  render();
  if (showMessage) showToast("今日数据已生成");
}

function saveManualPrice(event) {
  event.preventDefault();
  const stockId = els.priceStock.value;
  const close = Number(els.priceClose.value);
  const changePct = Number(els.priceChange.value);
  const date = els.priceDate.value;

  if (!stockId || !date || !Number.isFinite(close) || close <= 0 || !Number.isFinite(changePct)) {
    showToast("记录不完整");
    return;
  }

  upsertPrice({ stockId, date, close: round(close, 2), changePct: round(changePct, 2) });
  syncConceptSnapshot();
  buildReports(false);
  saveState();
  render();
  els.priceClose.value = "";
  els.priceChange.value = "";
  showToast("收盘已记录");
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
  const today = formatDate(new Date());
  state.concepts = state.stocks.flatMap((stock) =>
    conceptsForStock(stock.id).map((tag, index) => ({
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
  renderPriceOptions();
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

  state.stocks.forEach((stock) => {
    const latest = latestPrice(stock.id);
    const row = document.createElement("tr");
    const tags = conceptsForStock(stock.id).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
    row.innerHTML = `
      <td data-label="股票">
        <div class="stock-title">
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

function renderPriceOptions() {
  els.priceStock.innerHTML = state.stocks.length
    ? state.stocks.map((stock) => `<option value="${stock.id}">${escapeHtml(stock.name)} ${stock.code}</option>`).join("")
    : `<option value="">暂无股票</option>`;
}

function renderStockCards() {
  els.stockCards.innerHTML = state.stocks.length
    ? state.stocks
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

function deleteStock(stockId) {
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
