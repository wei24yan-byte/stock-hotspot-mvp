# Market Radar V85 架构

## 目标

- 首屏不再下载完整 60 日日线。
- 手机与电脑通过同一 Supabase 登录账户同步。
- 股票、计划、执行记录、报告和历史行情独立保存。
- 删除通过实体软删除生效，不再被另一台设备的旧整包数据复活。
- 行情和风险摘要由服务器计算，浏览器只展示轻量结果。

## 数据流

1. 浏览器优先渲染本机缓存。
2. 已登录时读取 `dashboard/primary` 轻量实体。
3. 后台读取股票、计划、执行记录和报告，不读取完整日线。
4. 打开总览折线图、报告或生成计划建议时，按股票读取 `history` 实体。
5. 新增股票后调用 `refresh-stock` Edge Function，立即补齐最多 60 个交易日。
6. GitHub Actions 每 10 分钟补漏，交易日 16:20 更新收盘数据和轻量摘要。

## 实体

| bucket | entity_id | 内容 |
| --- | --- | --- |
| `stock` | 股票 UUID | 名称、代码、概念、状态、轻量行情摘要 |
| `history` | 股票 UUID | 最多 60 个交易日完整 OHLCV |
| `plan` | 计划 UUID | 买入、失效、目标、仓位与退出逻辑 |
| `trade_log` | 记录 UUID | 买入、卖出、放弃及执行原因 |
| `report` | 报告 UUID | 日报 |
| `snapshot` | 日期 | 当日股票状态快照 |
| `setting` | `risk` | 风险参数 |
| `dashboard` | `primary` | 手机首页轻量结果 |
| `tombstone` | 股票 UUID | 删除记录 |

## 安全边界

- 浏览器只持有公开 anon key 和用户短期 access token。
- RLS 仅允许用户读写 `owner_id = auth.uid()` 的实体。
- Service role key 只保存在 GitHub Actions Secrets 和 Supabase Edge Function 环境。
- V84 `app_state` 在迁移完成前保持只读备份；迁移验证后应删除匿名写策略。

## 性能目标

- 已有本机缓存：首屏可交互小于 0.8 秒。
- 新设备且已登录：轻量首页 1 至 2 秒。
- 未登录兼容模式：旧云端整包最多等待 1.2 秒，之后先显示静态数据。
- 完整日线只在需要时下载。

## 发布门槛

- `node --check app.js v85-cloud.js service-worker.js`
- `python -m unittest discover -s tests -v`
- 桌面和手机尺寸检查今日、总览、计划、股票、报告。
- 先用测试账户迁移并核对股票、计划、持仓状态、执行记录数量。
- 保留 V84.3 线上版本和 `primary-v2` 备份，确认后再切换。
