# Cloudflare 部署记录

## 更新前基线（2026-11-26）

- Worker：`misty-grass-7f92`
- 地址：`https://misty-grass-7f92.drbegapunk97.workers.dev`
- 账号 ID：`b52217c78219b8425f063fdd895583a2`
- 活动部署 ID：`52bf4271-771e-492a-92b0-12f8e425fed6`
- 活动版本 ID：`432fa575-f245-4ab4-93bd-564b7ae5f7fb`（版本 1，2026-11-24T11:38:25Z，Dashboard 上传）
- 原配置：静态资源直出；`not_found_handling: none`；兼容日期 `2026-11-24`；绑定列表为空。
- 原线上响应：首页、`/manifest.webmanifest`、`/sw.js` 均为 HTTP 200；`/network-test`、`/api/health`、`/api/ws` 均为 404。
- 原首页 SHA-256：`e03d2e615bcdae63cc99e179238a0c5a07f15d482c6de9ea6a32cf98fcac11cf`。
- 原 Manifest SHA-256：`450006688b31eb5da28a477bb8b4577bfdbb3ad58de6e7860caec231529a06f3`。
- 原 Service Worker SHA-256：`79b929233bf7621dc02561be4c21ff583deff6f00f5d9cb01ee31d1623f04aa7`。

原线上静态文件和恢复配置保存在项目根目录的 `backups/cloudflare-misty-grass-7f92-before-connectivity-2026-11-25.zip`。备份内的 `original-static-manifest.json` 逐个记录文件哈希；本机解包工作目录为 `.tmp-gen/cloudflare-predeploy/`。备份不纳入 Git，以免把约 15 MB 的生成文件写入源码历史。部署前，主配置和恢复配置均通过 `wrangler deploy --dry-run`。

备份 ZIP 的 SHA-256：`9542cc2097258a7e9e76bd1e2f8baa8c03310764bbf855f02e93d70738462f7e`。已核对 ZIP 内含原首页、PWA 文件、WASM 和恢复配置。

## 恢复旧页面的步骤

新增 SQLite Durable Object 类后，Cloudflare 不允许直接将活动版本回滚到上述版本 1。要恢复原网页，先将备份 ZIP 解压到 `.tmp-gen/cloudflare-predeploy/`，然后在 `frontend` 目录运行：

```powershell
.\node_modules\.bin\wrangler.cmd deploy --config ..\.tmp-gen\cloudflare-predeploy\fallback-wrangler.jsonc --keep-vars
```

此恢复包重新部署原静态文件和安全响应头，同时保留已经迁移的 SQLite 类；它是功能恢复方案，生成的新版本 ID 不会等于版本 1。执行前应再次核对目标账号和 Worker 名称。Cloudflare 的限制见[官方回滚文档](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)。

## 连通性版本

- 部署时间：2026-11-26T11:15:28.998133Z。
- 新活动部署 ID：`51ea1d40-0f71-4438-bafa-fd92481c8b0e`。
- 新活动版本 ID：`6f64b9a7-f86e-45f9-a742-1021c11b5b36`（版本 2，Wrangler 上传，100% 流量）。
- 仍为原 Worker 和原 `workers.dev` 域名。新版本启用了 `ASSETS` 静态资源绑定、`CONNECTIVITY` SQLite Durable Object 绑定，迁移标签为 `v1-connectivity-sqlite`；`/api/*` 由 Worker 优先处理。
- Wrangler 4.168.0 的主配置和恢复配置离线预检通过；本地 `workerd` 页面测试：HTTP 200、两个 WebSocket 均返回 101 且互发回传成功。
- 线上浏览器测试：首页、PWA Manifest、Service Worker 均为 200；Service Worker 成功注册；`/network-test` 页面 HTTP 200，`/api/health` 返回 JSON HTTP 200 且 `Cache-Control: no-store`，WebSocket 两端互发并收到对应随机标记。对 `/api/ws` 的普通 HTTP 请求返回 JSON 426，确认不会落入 PWA 页面回退。
- 线上演示界面浏览器烟测 38/38 通过，未请求 Matrix 或外部域名。测试使用本机网络；**中国大陆无 VPN 多设备可达性仍待用户实测**。
