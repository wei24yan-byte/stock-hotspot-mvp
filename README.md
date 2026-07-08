# Market Radar V1 正式版

这是免费自用版的 V1 正式版，使用静态网页实现，不需要安装依赖。

## 已完成

- 手机和电脑浏览器都可打开的 PWA 页面。
- 添加股票并自动识别市场、记录添加日期。
- “今日”页支持置顶重点股票；“股票”页可停用或删除股票，删除会同步清理关联行情、新闻和概念记录。
- 添加股票时手动填写热点概念，后续可在个股明细里编辑。
- 刷新真实行情并生成相关新闻，新闻标题优先使用手动概念。
- 生成日报。
- JSON 导入导出。
- Supabase 表结构草案。
- Supabase 免费数据库同步配置区。
- GitHub Actions 收盘定时任务脚本和工作流。

## 本地运行

在当前目录启动服务：

```bash
python3 server.py --host 127.0.0.1 --port 8777
```

然后打开：

```text
http://127.0.0.1:8777/index.html
```

手机和电脑要看同一份数据时，让电脑和手机连同一个 Wi-Fi，然后用电脑的局域网 IP 启动：

```bash
python3 server.py --host 0.0.0.0 --port 8777
```

手机访问：

```text
http://电脑局域网IP:8777/index.html
```

## 后续开发

1. 用 Supabase 替换浏览器本地存储。
2. 加股票搜索和真实行情源。
3. 把项目推到 GitHub，启用收盘定时任务。
4. 加邮件、飞书、企业微信或 Telegram 推送。
5. 后续可在手动概念基础上增加 AI 辅助建议，但不自动覆盖人工标签。

## 收盘自动任务

查看设置说明：

```text
docs/github-actions-setup.md
```

本地演示运行：

```bash
python3 scripts/market_close_job.py --state data/state.json --offline-demo --force
```

说明：GitHub Actions 会更新仓库里的 `data/state.json`。静态部署时，网页会读取这个文件；本地运行 `server.py` 时，网页会优先走本地同步接口。

## Supabase 云端同步

1. 在 Supabase SQL Editor 执行：

```text
docs/supabase-app-state.sql
```

2. 在网页“股票”页底部填入 Project URL 和 anon key。
3. 点击“保存并上传”。

这是免费自用 MVP 的简化方案：所有数据存在 `app_state.default` 这一行 JSON 里。后续如果需要多人、多账户或更复杂查询，再迁移到规范化表。
