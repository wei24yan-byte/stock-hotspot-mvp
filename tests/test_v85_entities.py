import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import v85_entities  # noqa: E402


class V85EntityTests(unittest.TestCase):
    def setUp(self):
        self.stock = {
            "id": "stock-1",
            "code": "600000",
            "market": "SH",
            "name": "测试股票",
            "addedAt": "2026-07-01",
            "active": True,
            "concepts": ["测试"],
        }
        self.prices = [
            {
                "id": f"p-{day}",
                "stockId": "stock-1",
                "date": f"2026-07-{day:02d}",
                "open": 9 + day,
                "high": 10.5 + day,
                "low": 8.5 + day,
                "close": 10 + day,
                "changePct": 1.0,
            }
            for day in range(1, 11)
        ]

    def test_market_summary_is_lightweight_and_complete(self):
        summary = v85_entities.market_summary(self.stock, self.prices)
        self.assertEqual(summary["historyCount"], 10)
        self.assertEqual(len(summary["sparkline"]), 10)
        self.assertEqual(summary["latest"]["date"], "2026-07-10")
        self.assertEqual(summary["strategyVersion"], "v85.1")
        self.assertIn(summary["risk"]["label"], {"观察", "持有观察", "风险复核", "暂缓追涨"})

    def test_computed_rows_split_history_from_dashboard(self):
        state = {
            "stocks": [self.stock],
            "prices": self.prices,
            "plans": [],
            "reports": [],
            "riskSettings": {},
            "deletedStocks": [],
        }
        rows = v85_entities.computed_rows("owner-1", state)
        buckets = {(row["bucket"], row["entity_id"]) for row in rows}
        self.assertIn(("stock", "stock-1"), buckets)
        self.assertIn(("history", "stock-1"), buckets)
        self.assertIn(("dashboard", "primary"), buckets)
        dashboard = next(row for row in rows if row["bucket"] == "dashboard")["data"]["state"]
        self.assertEqual(len(dashboard["prices"]), 1)
        self.assertNotIn("prices", dashboard["stocks"][0]["marketSummary"])

    def test_deleted_rows_do_not_reappear_when_rebuilding_state(self):
        rows = [
            {
                "bucket": "stock",
                "entity_id": "stock-1",
                "data": self.stock,
                "deleted_at": "2026-07-26T00:00:00Z",
                "updated_at": "2026-07-26T00:00:00Z",
            },
            {
                "bucket": "stock",
                "entity_id": "stock-2",
                "data": {**self.stock, "id": "stock-2"},
                "deleted_at": None,
                "updated_at": "2026-07-26T00:00:01Z",
            },
        ]
        state = v85_entities.state_from_rows(rows)
        self.assertEqual([stock["id"] for stock in state["stocks"]], ["stock-2"])

    def test_market_context_uses_all_available_stocks(self):
        stocks = [
            {"marketSummary": {"returns": {"today": value}}}
            for value in (2.0, 1.5, 0.8, -0.2)
        ]
        context = v85_entities.market_context(stocks, "2026-07-24")
        self.assertEqual(context["sampleSize"], 4)
        self.assertEqual(context["positiveRatio"], 75.0)
        self.assertEqual(context["regime"], "偏强")


if __name__ == "__main__":
    unittest.main()
