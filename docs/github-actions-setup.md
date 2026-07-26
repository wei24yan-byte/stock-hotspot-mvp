# GitHub Actions 收盘任务设置

## 已加入的能力

- 每个工作日中国时间 16:20 自动运行。
- 脚本会先判断是否交易日；默认按周一到周五，节假日从 `data/cn_market_holidays.csv` 里读取。
- 读取 `data/state.json` 中的股票池。
- 抓取免费行情，当前优先使用新浪行情。
- 按 `股票名称 + 手动概念` 抓取公开新闻标题，当前使用 Bing News RSS。
- 写入每日行情、新闻标题、手动概念快照、日报。
- 周五生成周报。
- 每月最后一个交易日生成月报。
- 自动提交更新后的 `data/state.json`。

## 启用方式

把 `outputs/stock-hotspot-mvp` 作为一个 GitHub 仓库根目录后，提交这些文件：

```text
.github/workflows/market-close.yml
scripts/market_close_job.py
data/state.json
data/cn_market_holidays.csv
```

进入 GitHub 仓库的 Actions 页面，启用 workflow。之后它会按计划自动运行。

网页静态部署时会读取 `data/state.json`，所以 GitHub Actions 更新后，电脑和手机刷新页面即可看到收盘数据。手机端新增股票如果只保存在浏览器本地，不会自动提交到 GitHub；正式多端写入仍建议后续接 Supabase。

如果已经接入 Supabase，在仓库 Settings -> Secrets and variables -> Actions 里添加：

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_OWNER_ID
```

设置 `SUPABASE_OWNER_ID` 后，Actions 会读写 V85 的 `radar_entities`，只更新行情、日线、日报和首页摘要，不覆盖计划或执行记录。未设置时继续使用 V84 `app_state.primary-v2` 兼容模式。

## 节假日维护

免费版不接付费交易日历，所以需要在 `data/cn_market_holidays.csv` 手动维护 A 股休市日：

```csv
date,name
2026-10-01,国庆节
2026-10-02,国庆节
```

如果没有维护节假日，脚本仍会在周一到周五运行，但法定休市日可能会跑一次，行情源通常会没有新数据。

## 手动测试

在仓库根目录运行：

```bash
python scripts/market_close_job.py --state data/state.json --offline-demo --force
```

测试真实免费源：

```bash
python scripts/market_close_job.py --state data/state.json --force
```

## 注意

- 免费行情和新闻源没有 SLA，偶尔失败是正常的。
- 新闻只保存标题、链接、来源和空摘要，不保存全文。
- 概念以手动填写为主，自动任务不会覆盖人工概念。
