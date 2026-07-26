"""Supabase entity storage and lightweight market summaries for Market Radar V85."""

from __future__ import annotations

import datetime as dt
import json
import math
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


ENTITY_TABLE = "radar_entities"
SCHEMA_VERSION = 85
READ_BUCKETS = ("stock", "history", "plan", "trade_log", "report", "snapshot", "setting", "tombstone")


def pull_state(url: str, key: str, owner_id: str) -> dict[str, Any] | None:
    bucket_filter = ",".join(READ_BUCKETS)
    query = urllib.parse.urlencode(
        {
            "owner_id": f"eq.{owner_id}",
            "bucket": f"in.({bucket_filter})",
            "select": "bucket,entity_id,data,deleted_at,updated_at",
        },
        safe="(),.",
    )
    request = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/{ENTITY_TABLE}?{query}",
        headers=headers(key),
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            rows = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"V85 pull failed: {exc}")
        return None
    return state_from_rows(rows)


def push_computed_state(url: str, key: str, owner_id: str, state: dict[str, Any]) -> bool:
    rows = computed_rows(owner_id, state)
    endpoint = f"{url.rstrip('/')}/rest/v1/{ENTITY_TABLE}?on_conflict=owner_id,bucket,entity_id"
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(rows, ensure_ascii=False).encode("utf-8"),
        headers={
            **headers(key),
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            if response.status not in (200, 201, 204):
                raise RuntimeError(f"unexpected status {response.status}")
        print(f"V85 computed entities pushed: {len(rows)}")
        return True
    except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
        print(f"V85 push failed: {exc}")
        return False


def state_from_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    active = [row for row in rows if not row.get("deleted_at")]

    def values(bucket: str) -> list[dict[str, Any]]:
        return [row.get("data") or {} for row in active if row.get("bucket") == bucket]

    histories = values("history")
    risk = next(
        (row.get("data") or {} for row in active if row.get("bucket") == "setting" and row.get("entity_id") == "risk"),
        {},
    )
    return {
        "stocks": values("stock"),
        "prices": [price for history in histories for price in history.get("prices", [])],
        "news": [],
        "concepts": [],
        "reports": values("report"),
        "plans": values("plan"),
        "tradeLogs": values("trade_log"),
        "snapshots": values("snapshot"),
        "riskSettings": risk,
        "deletedStocks": values("tombstone"),
        "syncMeta": {
            "schemaVersion": SCHEMA_VERSION,
            "source": "radar_entities",
            "updatedAt": max((str(row.get("updated_at") or "") for row in active), default=""),
        },
    }


def computed_rows(owner_id: str, state: dict[str, Any]) -> list[dict[str, Any]]:
    stocks = []
    rows: list[dict[str, Any]] = []
    for raw_stock in state.get("stocks", []):
        if raw_stock.get("active", True) is False:
            continue
        stock = {**raw_stock, "marketSummary": market_summary(raw_stock, state.get("prices", []))}
        stocks.append(stock)
        history = sorted(
            [item for item in state.get("prices", []) if item.get("stockId") == stock.get("id")],
            key=lambda item: str(item.get("date") or ""),
        )[-60:]
        rows.append(entity(owner_id, "stock", str(stock["id"]), stock))
        rows.append(
            entity(
                owner_id,
                "history",
                str(stock["id"]),
                {
                    "stockId": stock["id"],
                    "market": stock.get("market"),
                    "code": stock.get("code"),
                    "prices": history,
                },
            )
        )

    for report in state.get("reports", []):
        rows.append(entity(owner_id, "report", str(report.get("id")), report))

    latest_date = max(
        (str(item.get("date") or "") for item in state.get("prices", [])),
        default="",
    )
    rows.append(
        entity(
            owner_id,
            "dashboard",
            "primary",
            {
                "generatedAt": utc_now(),
                "schemaVersion": SCHEMA_VERSION,
                "state": {
                    "stocks": stocks,
                    "prices": [
                        stock["marketSummary"]["latest"]
                        for stock in stocks
                        if stock.get("marketSummary", {}).get("latest")
                    ],
                    "plans": current_plans(state.get("plans", [])),
                    "tradeLogs": [],
                    "reports": [],
                    "snapshots": [],
                    "riskSettings": state.get("riskSettings") or {},
                    "deletedStocks": state.get("deletedStocks") or [],
                    "news": [],
                    "concepts": [],
                    "marketContext": market_context(stocks, latest_date),
                    "syncMeta": {
                        "schemaVersion": SCHEMA_VERSION,
                        "source": "github-actions-summary",
                        "updatedAt": utc_now(),
                    },
                },
            },
        )
    )
    return rows


def entity(owner_id: str, bucket: str, entity_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "owner_id": owner_id,
        "bucket": bucket,
        "entity_id": entity_id,
        "data": data,
        "source_version": SCHEMA_VERSION,
        "deleted_at": None,
    }


def market_summary(stock: dict[str, Any], all_prices: list[dict[str, Any]]) -> dict[str, Any] | None:
    prices = sorted(
        [
            item
            for item in all_prices
            if item.get("stockId") == stock.get("id") and finite(item.get("close"))
        ],
        key=lambda item: str(item.get("date") or ""),
    )[-60:]
    if not prices:
        return None
    latest = prices[-1]
    closes = [float(item["close"]) for item in prices]
    latest_day = dt.date.fromisoformat(str(latest["date"]))
    week_start = latest_day - dt.timedelta(days=latest_day.weekday())
    month_start = latest_day.replace(day=1)
    week_base = next((item for item in prices if str(item["date"]) >= week_start.isoformat()), latest)
    month_base = next((item for item in prices if str(item["date"]) >= month_start.isoformat()), latest)
    added_at = str(stock.get("addedAt") or prices[0]["date"])
    added_base = next((item for item in prices if str(item["date"]) >= added_at), prices[0])
    return {
        "latest": latest,
        "returns": {
            "today": number_or_none(latest.get("changePct")),
            "weekly": percent_change(latest["close"], week_base["close"]),
            "monthly": percent_change(latest["close"], month_base["close"]),
            "sinceAdded": percent_change(latest["close"], added_base["close"]),
        },
        "high": max(closes),
        "low": min(closes),
        "sparkline": closes[-20:],
        "historyCount": len(prices),
        "risk": risk_summary(prices),
        "strategyVersion": "v85.1",
        "computedAt": utc_now(),
    }


def risk_summary(prices: list[dict[str, Any]]) -> dict[str, Any]:
    if len(prices) < 5:
        return {"tone": "muted", "label": "数据积累中", "reason": f"当前记录{len(prices)}个交易日"}
    closes = [float(item["close"]) for item in prices]
    returns = [percent_change(closes[index], closes[index - 1]) or 0 for index in range(1, len(closes))]
    recent = returns[-10:]
    average = sum(recent) / len(recent)
    volatility = math.sqrt(sum((item - average) ** 2 for item in recent) / len(recent))
    trend = percent_change(closes[-1], closes[max(0, len(closes) - 5)]) or 0
    drawdown = percent_change(closes[-1], max(closes)) or 0
    latest_change = number_or_none(prices[-1].get("changePct")) or 0
    detail = f"近{len(recent)}日波动{volatility:.2f}%/日，5日趋势{signed_pct(trend)}，阶段回撤{signed_pct(drawdown)}"
    if latest_change <= -5 and trend < 0:
        return {"tone": "risk", "label": "风险复核", "reason": f"{detail}，今日下跌与短线趋势同向"}
    if latest_change >= 5 and volatility >= 3:
        return {"tone": "caution", "label": "暂缓追涨", "reason": f"{detail}，今日上涨但波动处于高位"}
    if trend >= 3 and volatility < 3:
        return {"tone": "hold", "label": "持有观察", "reason": f"{detail}，趋势偏强且波动尚可"}
    return {"tone": "watch", "label": "观察", "reason": f"{detail}，暂未形成明确操作信号"}


def market_context(stocks: list[dict[str, Any]], latest_date: str) -> dict[str, Any]:
    changes = [
        number_or_none(stock.get("marketSummary", {}).get("returns", {}).get("today"))
        for stock in stocks
        if stock.get("marketSummary")
    ]
    values = [value for value in changes if value is not None]
    average = round(sum(values) / len(values), 2) if values else None
    positive_ratio = round(sum(value > 0 for value in values) / len(values) * 100, 1) if values else None
    if average is None:
        regime = "数据不足"
    elif average >= 1 and (positive_ratio or 0) >= 60:
        regime = "偏强"
    elif average <= -1 and (positive_ratio or 100) <= 40:
        regime = "偏弱"
    else:
        regime = "震荡"
    return {
        "date": latest_date,
        "regime": regime,
        "averageChangePct": average,
        "positiveRatio": positive_ratio,
        "sampleSize": len(values),
    }


def current_plans(plans: list[dict[str, Any]]) -> list[dict[str, Any]]:
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date().isoformat()
    return [plan for plan in plans if str(plan.get("date") or "") >= today]


def headers(key: str) -> dict[str, str]:
    return {
        "User-Agent": "Market-Radar-V85/1.0",
        "Accept": "application/json",
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }


def percent_change(current: Any, base: Any) -> float | None:
    if not finite(current) or not finite(base) or float(base) == 0:
        return None
    return round((float(current) / float(base) - 1) * 100, 2)


def finite(value: Any) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def number_or_none(value: Any) -> float | None:
    return float(value) if finite(value) else None


def signed_pct(value: float) -> str:
    return f"{'+' if value > 0 else ''}{value:.2f}%"


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
