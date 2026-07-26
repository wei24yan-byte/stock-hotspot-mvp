const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const authorization = request.headers.get("Authorization") || "";
    const { stockId } = await request.json();
    if (!supabaseUrl || !anonKey || !authorization || !stockId) {
      return json({ error: "missing configuration or stockId" }, 400);
    }

    const commonHeaders = {
      apikey: anonKey,
      Authorization: authorization,
      Accept: "application/json",
      "Content-Type": "application/json"
    };
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: commonHeaders });
    if (!userResponse.ok) return json({ error: "unauthorized" }, 401);
    const user = await userResponse.json();

    const stockQuery = new URLSearchParams({
      owner_id: `eq.${user.id}`,
      bucket: "eq.stock",
      entity_id: `eq.${stockId}`,
      deleted_at: "is.null",
      select: "data"
    });
    const stockResponse = await fetch(`${supabaseUrl}/rest/v1/radar_entities?${stockQuery}`, {
      headers: commonHeaders
    });
    if (!stockResponse.ok) throw new Error(`stock lookup ${stockResponse.status}`);
    const stock = (await stockResponse.json())?.[0]?.data;
    if (!stock) return json({ error: "stock not found" }, 404);

    const symbol = `${String(stock.market || "").toLowerCase()}${stock.code}`;
    const params = encodeURIComponent(`${symbol},day,,,61,`);
    const historyResponse = await fetch(
      `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${params}`,
      { headers: { Referer: "https://gu.qq.com/", "User-Agent": "Market-Radar-V85/1.0" } }
    );
    if (!historyResponse.ok) throw new Error(`history provider ${historyResponse.status}`);
    const payload = await historyResponse.json();
    const rawRows = payload?.data?.[symbol]?.day || [];
    const prices = normalizePrices(stockId, rawRows).slice(-60);
    if (prices.length < 5) return json({ error: "history unavailable", count: prices.length }, 502);

    const summary = buildSummary(stock, prices);
    const rows = [
      entity(user.id, "history", stockId, {
        stockId,
        market: stock.market,
        code: stock.code,
        prices
      }),
      entity(user.id, "stock", stockId, { ...stock, marketSummary: summary })
    ];
    const upsertResponse = await fetch(
      `${supabaseUrl}/rest/v1/radar_entities?on_conflict=owner_id,bucket,entity_id`,
      {
        method: "POST",
        headers: { ...commonHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows)
      }
    );
    if (!upsertResponse.ok) throw new Error(`entity upsert ${upsertResponse.status}`);
    return json({ ok: true, stockId, count: prices.length, summary });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function normalizePrices(stockId: string, rows: unknown[][]) {
  let previousClose: number | null = null;
  return rows.flatMap((row) => {
    const [date, open, close, high, low, volume] = row;
    const closeValue = Number(close);
    if (!date || !Number.isFinite(closeValue)) return [];
    const changePct =
      previousClose && previousClose > 0
        ? round((closeValue / previousClose - 1) * 100)
        : null;
    previousClose = closeValue;
    return [{
      id: `${stockId}-${date}`,
      stockId,
      date: String(date),
      open: numberOrNull(open),
      high: numberOrNull(high),
      low: numberOrNull(low),
      close: closeValue,
      volume: numberOrNull(volume),
      amount: null,
      changePct
    }];
  });
}

function buildSummary(stock: Record<string, unknown>, prices: Record<string, unknown>[]) {
  const latest = prices.at(-1)!;
  const closes = prices.map((item) => Number(item.close));
  const latestDate = new Date(`${latest.date}T00:00:00+08:00`);
  const monday = new Date(latestDate);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const monthStart = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);
  const weekBase = prices.find((item) => String(item.date) >= isoDate(monday)) || latest;
  const monthBase = prices.find((item) => String(item.date) >= isoDate(monthStart)) || latest;
  const addedBase = prices.find((item) => String(item.date) >= String(stock.addedAt || "")) || prices[0];
  return {
    latest,
    returns: {
      today: latest.changePct,
      weekly: percentChange(latest.close, weekBase.close),
      monthly: percentChange(latest.close, monthBase.close),
      sinceAdded: percentChange(latest.close, addedBase.close)
    },
    high: Math.max(...closes),
    low: Math.min(...closes),
    sparkline: closes.slice(-20),
    historyCount: prices.length,
    risk: riskSummary(prices),
    strategyVersion: "v85.1",
    computedAt: new Date().toISOString()
  };
}

function riskSummary(prices: Record<string, unknown>[]) {
  const closes = prices.map((item) => Number(item.close));
  const returns = closes.slice(1).map((close, index) => percentChange(close, closes[index]) || 0);
  const recent = returns.slice(-10);
  const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const volatility = Math.sqrt(
    recent.reduce((sum, value) => sum + (value - average) ** 2, 0) / recent.length
  );
  const trend = percentChange(closes.at(-1), closes[Math.max(0, closes.length - 5)]) || 0;
  const latestChange = Number(prices.at(-1)?.changePct || 0);
  if (latestChange <= -5 && trend < 0) return { tone: "risk", label: "风险复核", reason: "大跌与短线趋势同向" };
  if (latestChange >= 5 && volatility >= 3) return { tone: "caution", label: "暂缓追涨", reason: "涨幅与波动同时偏高" };
  if (trend >= 3 && volatility < 3) return { tone: "hold", label: "持有观察", reason: "趋势偏强且波动尚可" };
  return { tone: "watch", label: "观察", reason: "暂未形成明确操作信号" };
}

function entity(ownerId: string, bucket: string, entityId: string, data: unknown) {
  return {
    owner_id: ownerId,
    bucket,
    entity_id: entityId,
    data,
    source_version: 85,
    deleted_at: null
  };
}

function percentChange(current: unknown, base: unknown) {
  const currentValue = Number(current);
  const baseValue = Number(base);
  return Number.isFinite(currentValue) && Number.isFinite(baseValue) && baseValue !== 0
    ? round((currentValue / baseValue - 1) * 100)
    : null;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
