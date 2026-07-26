import datetime as dt
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import market_close_job  # noqa: E402


class MarketCalendarTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.holidays = market_close_job.load_holidays(ROOT / "data" / "cn_market_holidays.csv")

    def test_weekday_is_trading_day(self):
        self.assertTrue(market_close_job.is_trading_day(dt.date(2026, 7, 24), self.holidays))

    def test_weekend_is_closed(self):
        self.assertFalse(market_close_job.is_trading_day(dt.date(2026, 7, 25), self.holidays))

    def test_official_holiday_is_closed(self):
        self.assertFalse(market_close_job.is_trading_day(dt.date(2026, 10, 5), self.holidays))

    def test_next_trading_day_skips_national_day(self):
        self.assertEqual(
            market_close_job.next_trading_day(dt.date(2026, 9, 30), self.holidays),
            dt.date(2026, 10, 8),
        )


if __name__ == "__main__":
    unittest.main()
