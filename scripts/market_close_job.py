#!/usr/bin/env python3
"""
Market close updater for the free personal stock hotspot MVP.

The script reads data/state.json, fetches end-of-day quotes and public news
titles for active stocks, then writes the updated JSON back. It intentionally
uses only Python standard library modules so it can run on GitHub Actions
without dependency installation.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import html
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


EMPTY_STATE = {"stocks": [], "prices": [], "news": [], "concepts": [], "reports": []}
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15",
    "Accept": "*/*",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update stock quotes, news, and reports.")
    parser.add_argument("--state", default="data/state.json", help="Path to app state JSON.")
    parser.add_argument("--date", help="Trade date in YYYY-MM-DD. Defaults to today in Asia/Shanghai.")
    parser.add_argument("--holidays", default="data/cn_market_holidays.csv", help="CSV file of market holidays.")
    parser.add_argument("--force", action="store_true", help="Run even if the date is not a trading day.")
    parser.add_argument("--offline-demo", action="store_true", help="Generate deterministic demo data without network.")
    parser.add_argument("--news-limit", type=int, default=3, help="News titles to keep per stock.")
    parser.add_argument("--history-days", type=int, default=60, help="Daily bars to retain per active stock.")
    parser.add_argument("--supabase-url", help="Optional Supabase project URL.")
    parser.add_argument("--supabase-key", help="Optional Supabase anon or service role key.")
    parser.add_argument("--supabase-row-id", default="default", help="Row id in app_state table.")
    parser.add_argument("--dry-run", action="store_true", help="Print summary without writing state.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    state_path = Path(args.state)
    trade_date = parse_date(args.date) if args.date else today_shanghai()
    holidays = load_holidays(Path(args.holidays))

    if not args.force and not is_trading_day(trade_date, holidays):
        print(f"{trade_date} is not a trading day. Skip.")
        return 0

    state = load_state(state_path)
    cloud_state = pull_supabase_state(args.supabase_url, args.supabase_key, args.supabase_row_id)
    if cloud_state:
        state = cloud_state
    active_stocks = [normalize_stock(stock) for stock in state["stocks"] if stock.get("active", True)]
    state["stocks"] = [normalize_stock(stock) for stock in state["stocks"]]

    quote_results = []
    news_results = []

    for stock in active_stocks:
        if not args.offline_demo and history_needs_backfill(state, stock["id"], args.history_days):
            history = fetch_tencent_history(stock, args.history_days)
            for bar in history:
                upsert_price(state, stock["id"], bar)
            if history:
                print(f"history backfilled: {stock['market']}{stock['code']} {len(history)} bars")

        quote = demo_quote(stock, trade_date, state) if args.offline_demo else fetch_sina_quote(stock)
        if quote:
            upsert_price(state, stock["id"], {"date": trade_date.isoformat(), **quote})
            quote_results.append((stock["name"], quote["close"], quote["changePct"]))
        else:
            print(f"quote unavailable: {stock['market']}{stock['code']} {stock['name']}")

        stock_news = demo_news(stock, trade_date) if args.offline_demo else fetch_public_news(stock, args.news_limit)
        for item in stock_news[: args.news_limit]:
            upsert_news(state, stock, trade_date.isoformat(), item)
        news_results.extend((stock["name"], item["title"]) for item in stock_news[: args.news_limit])
        time.sleep(0.4 if not args.offline_demo else 0)

    prune_price_history(state, max(20, args.history_days))
    sync_concept_snapshot(state, trade_date)
    build_reports(state, trade_date, holidays)

    if args.dry_run:
        print_summary(quote_results, news_results, state)
        return 0

    save_state(state_path, state)
    if args.supabase_url and args.supabase_key:
        push_supabase_state(args.supabase_url, args.supabase_key, args.supabase_row_id, state)
    print_summary(quote_results, news_results, state)
    return 0


def today_shanghai() -> dt.date:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date()


def parse_date(value: str) -> dt.date:
    return dt.date.fromisoformat(value)


def load_holidays(path: Path) -> set[dt.date]:
    if not path.exists():
        return set()
    holidays: set[dt.date] = set()
    with path.open("r", encoding="utf-8") as file:
        for row in csv.DictReader(file):
            value = (row.get("date") or "").strip()
            if value and not value.startswith("#"):
                holidays.add(dt.date.fromisoformat(value))
    return holidays


def is_trading_day(day: dt.date, holidays: set[dt.date]) -> bool:
    return day.weekday() < 5 and day not in holidays


def next_trading_day(day: dt.date, holidays: set[dt.date]) -> dt.date:
    probe = day + dt.timedelta(days=1)
    for _ in range(14):
        if is_trading_day(probe, holidays):
            return probe
        probe += dt.timedelta(days=1)
    return probe


def is_last_trading_day_of_month(day: dt.date, holidays: set[dt.date]) -> bool:
    return next_trading_day(day, holidays).month != day.month


def is_last_trading_day_of_week(day: dt.date, holidays: set[dt.date]) -> bool:
    return week_start(next_trading_day(day, holidays)) != week_start(day)


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return json.loads(json.dumps(EMPTY_STATE))
    with path.open("r", encoding="utf-8") as file:
        return normalize_state(json.load(file))


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".tmp")
    with temp_path.open("w", encoding="utf-8") as file:
        json.dump(normalize_state(state), file, ensure_ascii=False, indent=2)
        file.write("\n")
    temp_path.replace(path)


def pull_supabase_state(url: str | None, key: str | None, row_id: str) -> dict[str, Any] | None:
    if not url or not key:
        return None
    endpoint = f"{url.rstrip('/')}/rest/v1/app_state?id=eq.{urllib.parse.quote(row_id)}&select=data"
    request = urllib.request.Request(endpoint, headers=supabase_headers(key))
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            rows = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"supabase pull skipped: {exc}")
        return None
    if rows and isinstance(rows, list) and rows[0].get("data"):
        print("supabase state loaded")
        return normalize_state(rows[0]["data"])
    return None


def push_supabase_state(url: str, key: str, row_id: str, state: dict[str, Any]) -> None:
    endpoint = f"{url.rstrip('/')}/rest/v1/app_state?on_conflict=id"
    body = json.dumps([{"id": row_id, "data": normalize_state(state)}], ensure_ascii=False).encode("utf-8")
    headers = {
        **supabase_headers(key),
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    request = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status not in (200, 201, 204):
                raise RuntimeError(f"unexpected status {response.status}")
        print("supabase state pushed")
    except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
        print(f"supabase push failed: {exc}")


def supabase_headers(key: str) -> dict[str, str]:
    return {
        **DEFAULT_HEADERS,
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }


def normalize_state(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return json.loads(json.dumps(EMPTY_STATE))
    return {
        **value,
        "stocks": value.get("stocks") if isinstance(value.get("stocks"), list) else [],
        "prices": value.get("prices") if isinstance(value.get("prices"), list) else [],
        "news": value.get("news") if isinstance(value.get("news"), list) else [],
        "concepts": value.get("concepts") if isinstance(value.get("concepts"), list) else [],
        "reports": value.get("reports") if isinstance(value.get("reports"), list) else [],
    }


def normalize_stock(stock: dict[str, Any]) -> dict[str, Any]:
    return {
        **stock,
        "id": stock.get("id") or make_id(),
        "code": clean_code(stock.get("code", "")),
        "name": str(stock.get("name", "")).strip(),
        "market": str(infer_market(stock.get("code", "")) or stock.get("market") or "SH").upper(),
        "addedAt": stock.get("addedAt") or stock.get("added_at") or today_shanghai().isoformat(),
        "active": stock.get("active", True) is not False,
        "concepts": normalize_concepts(stock.get("concepts", [])),
    }


def clean_code(value: Any) -> str:
    return "".join(ch for ch in str(value) if ch.isdigit())[:6]


def infer_market(value: Any) -> str:
    code = clean_code(value)
    if len(code) != 6:
        return ""
    sh_prefixes = ("600", "601", "603", "605", "688", "689", "900")
    sz_prefixes = ("000", "001", "002", "003", "200", "300", "301")
    bj_prefixes = (
        "430", "830", "831", "832", "833", "834", "835", "836", "837", "838", "839",
        "870", "871", "872", "873", "874", "875", "876", "877", "878", "879",
        "880", "881", "882", "883", "884", "885", "886", "887", "888", "889", "920",
    )
    if code.startswith(sh_prefixes):
        return "SH"
    if code.startswith(sz_prefixes):
        return "SZ"
    if code.startswith(bj_prefixes):
        return "BJ"
    if code.startswith("6"):
        return "SH"
    if code[0] in {"0", "2", "3"}:
        return "SZ"
    if code[0] in {"4", "8"}:
        return "BJ"
    return ""


def normalize_concepts(value: Any) -> list[str]:
    if isinstance(value, list):
        raw = value
    else:
        raw = str(value or "").replace(",", "、").replace("，", "、").split("、")
    concepts: list[str] = []
    seen: set[str] = set()
    for item in raw:
        text = str(item).strip()
        key = text.lower()
        if text and key not in seen:
            seen.add(key)
            concepts.append(text)
    return concepts[:12]


def fetch_sina_quote(stock: dict[str, Any]) -> dict[str, float] | None:
    symbol = sina_symbol(stock)
    if not symbol:
        return None
    url = f"https://hq.sinajs.cn/list={symbol}"
    request = urllib.request.Request(url, headers={**DEFAULT_HEADERS, "Referer": "https://finance.sina.com.cn/"})
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            text = response.read().decode("gb18030", errors="ignore")
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"sina quote error for {symbol}: {exc}")
        return None

    if '=""' in text or '="";' in text:
        return None
    payload = text.split('="', 1)[-1].rsplit('";', 1)[0]
    fields = payload.split(",")
    if len(fields) < 32:
        return None
    try:
        open_price = float(fields[1])
        prev_close = float(fields[2])
        current = float(fields[3])
        high = float(fields[4])
        low = float(fields[5])
        volume = float(fields[8])
        amount = float(fields[9])
    except ValueError:
        return None
    if current <= 0 or prev_close <= 0:
        return None
    return {
        "open": round(open_price, 2),
        "high": round(high, 2),
        "low": round(low, 2),
        "close": round(current, 2),
        "volume": volume,
        "amount": amount,
        "changePct": round((current - prev_close) / prev_close * 100, 2),
    }


def sina_symbol(stock: dict[str, Any]) -> str:
    market = stock["market"].upper()
    prefix = {"SH": "sh", "SZ": "sz", "BJ": "bj"}.get(market, "")
    return f"{prefix}{stock['code']}" if prefix and stock["code"] else ""


def fetch_tencent_history(stock: dict[str, Any], history_days: int) -> list[dict[str, float | str]]:
    symbol = sina_symbol(stock)
    if not symbol:
        return []
    count = max(21, min(180, history_days + 1))
    params = f"{symbol},day,,,{count},"
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={urllib.parse.quote(params, safe=',')}"
    request = urllib.request.Request(url, headers={**DEFAULT_HEADERS, "Referer": "https://gu.qq.com/"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"tencent history error for {symbol}: {exc}")
        return []

    rows = payload.get("data", {}).get(symbol, {}).get("day") or []
    bars: list[dict[str, float | str]] = []
    previous_close: float | None = None
    for row in rows:
        if not isinstance(row, list) or len(row) < 6:
            continue
        try:
            trade_date, open_price, close, high, low, volume = row[:6]
            close_value = float(close)
            bar = {
                "date": str(trade_date),
                "open": float(open_price),
                "high": float(high),
                "low": float(low),
                "close": close_value,
                "volume": float(volume),
                "amount": None,
                "changePct": round((close_value - previous_close) / previous_close * 100, 2)
                if previous_close
                else None,
            }
        except (TypeError, ValueError):
            continue
        bars.append(bar)
        previous_close = close_value
    return bars[-history_days:]


def fetch_public_news(stock: dict[str, Any], limit: int) -> list[dict[str, str]]:
    concepts = normalize_concepts(stock.get("concepts", []))
    query = f"{stock['name']} {' '.join(concepts[:2])} 股票"
    params = urllib.parse.urlencode({"q": query, "format": "rss", "mkt": "zh-CN"})
    url = f"https://www.bing.com/news/search?{params}"
    request = urllib.request.Request(url, headers=DEFAULT_HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            xml_text = response.read().decode("utf-8", errors="ignore")
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"news error for {stock['name']}: {exc}")
        return []

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    items = []
    for item in root.findall(".//item"):
        title = clean_text(item.findtext("title") or "")
        link = clean_text(item.findtext("link") or "")
        source = clean_text(item.findtext("source") or "") or "Bing News"
        if title and link:
            items.append({"title": title, "url": link, "source": source, "summary": ""})
        if len(items) >= limit:
            break
    return items


def clean_text(value: str) -> str:
    return html.unescape(value).replace("\n", " ").strip()


def demo_quote(stock: dict[str, Any], trade_date: dt.date, state: dict[str, Any]) -> dict[str, float]:
    last = latest_price(state, stock["id"])
    base = float(last["close"]) if last else 8 + stable_number(stock["code"], 70)
    change_pct = round((stable_number(f"{stock['code']}-{trade_date}", 700) - 330) / 100, 2)
    close = round(max(0.01, base * (1 + change_pct / 100)), 2)
    return {"close": close, "changePct": change_pct}


def demo_news(stock: dict[str, Any], trade_date: dt.date) -> list[dict[str, str]]:
    concept = normalize_concepts(stock.get("concepts", []))
    tag = concept[0] if concept else "未填写概念"
    title = f"{stock['name']}收盘表现受关注，市场继续跟踪{tag}"
    return [{
        "title": title,
        "url": f"https://www.bing.com/news/search?q={urllib.parse.quote(stock['name'] + ' ' + tag)}",
        "source": "离线演示",
        "summary": "",
    }]


def stable_number(text: str, modulo: int) -> int:
    value = 0
    for char in text:
        value = (value * 31 + ord(char)) & 0xFFFFFFFF
    return value % modulo


def latest_price(state: dict[str, Any], stock_id: str) -> dict[str, Any] | None:
    prices = [item for item in state["prices"] if item.get("stockId") == stock_id]
    return sorted(prices, key=lambda item: item.get("date", ""))[-1] if prices else None


def history_needs_backfill(state: dict[str, Any], stock_id: str, history_days: int) -> bool:
    required = min(max(20, history_days), 60)
    complete = [
        item for item in state["prices"]
        if item.get("stockId") == stock_id
        and all(item.get(field) is not None for field in ("high", "low", "close"))
    ]
    return len(complete) < required


def prune_price_history(state: dict[str, Any], history_days: int) -> None:
    stock_ids = {stock.get("id") for stock in state["stocks"]}
    retained = []
    for stock_id in stock_ids:
        rows = sorted(
            [item for item in state["prices"] if item.get("stockId") == stock_id],
            key=lambda item: item.get("date", ""),
        )
        retained.extend(rows[-history_days:])
    state["prices"] = retained


def upsert_price(state: dict[str, Any], stock_id: str, values: dict[str, Any]) -> None:
    trade_date = str(values.get("date") or "")
    if not trade_date or values.get("close") is None:
        return
    normalized = {
        "stockId": stock_id,
        "date": trade_date,
        "open": values.get("open"),
        "high": values.get("high"),
        "low": values.get("low"),
        "close": values.get("close"),
        "volume": values.get("volume"),
        "amount": values.get("amount"),
        "changePct": values.get("changePct"),
    }
    for item in state["prices"]:
        if item.get("stockId") == stock_id and item.get("date") == trade_date:
            item.update({key: value for key, value in normalized.items() if value is not None})
            return
    state["prices"].append({
        "id": make_id(),
        **normalized,
    })


def upsert_news(state: dict[str, Any], stock: dict[str, Any], news_date: str, item: dict[str, str]) -> None:
    if any(news.get("stockId") == stock["id"] and news.get("url") == item["url"] for news in state["news"]):
        return
    state["news"].append({
        "id": make_id(),
        "stockId": stock["id"],
        "date": news_date,
        "title": item["title"],
        "source": item.get("source") or "公开新闻",
        "url": item["url"],
        "summary": item.get("summary") or "",
    })
    state["news"] = sorted(state["news"], key=lambda news: news.get("date", ""), reverse=True)[:500]


def sync_concept_snapshot(state: dict[str, Any], trade_date: dt.date) -> None:
    concepts = []
    for stock in state["stocks"]:
        if stock.get("active", True) is False:
            continue
        for index, tag in enumerate(normalize_concepts(stock.get("concepts", []))):
            concepts.append({
                "id": f"{stock['id']}-{tag}",
                "stockId": stock["id"],
                "date": trade_date.isoformat(),
                "tag": tag,
                "reason": "手动输入",
                "score": 100 - index,
            })
    state["concepts"] = concepts


def build_reports(state: dict[str, Any], trade_date: dt.date, holidays: set[dt.date]) -> None:
    state["reports"] = [report for report in state.get("reports", []) if report.get("type") == "日报"]
    upsert_report(state, f"daily-{trade_date}", "日报", trade_date, build_report_content(state, trade_date, "日报", "daily"))


def upsert_report(state: dict[str, Any], report_id: str, report_type: str, report_date: dt.date, content: str) -> None:
    report = {"id": report_id, "type": report_type, "date": report_date.isoformat(), "content": content}
    for index, item in enumerate(state["reports"]):
        if item.get("id") == report_id:
            state["reports"][index] = report
            return
    state["reports"].append(report)


def build_report_content(state: dict[str, Any], trade_date: dt.date, title: str, period: str) -> str:
    rows = []
    for stock in state["stocks"]:
        latest = latest_price(state, stock["id"])
        if not latest:
            continue
        ret = latest.get("changePct") if period == "daily" else period_return(state, stock["id"], trade_date, period)
        rows.append({"stock": stock, "latest": latest, "ret": ret})
    rows.sort(key=lambda row: float(row["ret"] or 0), reverse=True)

    lines = [f"{trade_date} {title}", ""]
    if not rows:
        return f"{trade_date} {title}\n\n暂无行情记录"
    for index, row in enumerate(rows, start=1):
        stock = row["stock"]
        concepts = "、".join(normalize_concepts(stock.get("concepts", []))) or "暂无概念"
        lines.append(
            f"{index}. {stock['name']} {format_pct(row['ret'])}，"
            f"最新价 {float(row['latest']['close']):.2f}，概念：{concepts}"
        )
    hot = top_concepts(state)
    if hot:
        lines.extend(["", f"热点聚合：{hot[0][0]} 关联 {hot[0][1]} 次"])
    return "\n".join(lines)


def period_return(state: dict[str, Any], stock_id: str, trade_date: dt.date, period: str) -> float | None:
    if period == "weekly":
        start = week_start(trade_date)
    elif period == "monthly":
        start = trade_date.replace(day=1)
    else:
        start = trade_date
    prices = sorted(
        [
            item for item in state["prices"]
            if item.get("stockId") == stock_id and start.isoformat() <= item.get("date", "") <= trade_date.isoformat()
        ],
        key=lambda item: item.get("date", ""),
    )
    if len(prices) < 2:
        return None
    first = float(prices[0]["close"])
    last = float(prices[-1]["close"])
    return round((last - first) / first * 100, 2) if first else None


def week_start(day: dt.date) -> dt.date:
    return day - dt.timedelta(days=day.weekday())


def top_concepts(state: dict[str, Any]) -> list[tuple[str, int]]:
    counts: dict[str, int] = {}
    for stock in state["stocks"]:
        if stock.get("active", True) is False:
            continue
        for concept in normalize_concepts(stock.get("concepts", [])):
            counts[concept] = counts.get(concept, 0) + 1
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))


def format_pct(value: Any) -> str:
    if value is None:
        return "-"
    num = float(value)
    return f"{'+' if num > 0 else ''}{num:.2f}%"


def make_id() -> str:
    return str(uuid.uuid4())


def print_summary(quote_results: list[tuple[str, float, float]], news_results: list[tuple[str, str]], state: dict[str, Any]) -> None:
    print(f"quotes updated: {len(quote_results)}")
    for name, close, change_pct in quote_results:
        print(f"  {name}: close={close:.2f}, change={change_pct:+.2f}%")
    print(f"news added/read: {len(news_results)}")
    print(f"stocks: {len(state['stocks'])}, prices: {len(state['prices'])}, news: {len(state['news'])}, reports: {len(state['reports'])}")


if __name__ == "__main__":
    sys.exit(main())
