# Cloudflare 同源连通性验证（2026-11-26）

本阶段仅验证中国大陆无 VPN 浏览器到 Cloudflare 的 HTTP 与 WebSocket 连接。网页与 API 使用同一 `*.workers.dev` 域名；只发送浏览器临时生成的随机测试标记。没有账号、聊天室、消息存储或新的加密实现。旧 Matrix 代码保留，但网页上的真实登录入口已暂停。演示模式仍是本地模拟数据，不能用于私人通讯。

2026-11-26 已更新原 Worker，线上常规网络检查通过；中国大陆无 VPN 多设备实测待用户完成。部署版本和恢复记录见[部署记录](CLOUDFLARE-DEPLOYMENT-RECORD.md)。

## 已配置

- `frontend/wrangler.jsonc`：Workers Static Assets 发布 `dist`，`/api/*` 优先交给 Worker；`CONNECTIVITY` 绑定 SQLite 后端的 Durable Object。
- `GET /api/health`：返回 `ok: true`、服务名和服务器时间，禁止缓存。
- `GET /api/ws?probe=<32位小写十六进制>`：同源 WebSocket 升级。每个随机 `probe` 对应一个临时 Durable Object；它只转发 `{"type":"probe","nonce":"<16至64位小写十六进制>"}` 到该探针的连接，不写 SQLite。
- `/network-test`：测试 HTTP，并打开两个 WebSocket，让两端各发送一次随机标记，要求两端都收到对应回传。页面加载后点击“开始测试”。
- PWA 的导航回退排除了 `/api/*`，API 错误不会伪装成网页。

这里选用 Durable Object 内置 SQLite 后端，是为了验证免费套餐支持的部署形态；**本阶段没有建表或持久化消息**。用户库、D1、R2、WebRTC 和端到端加密协议选型均留待连通性验证通过后实施。

## 发布到现有 workers.dev

现有地址为 `https://misty-grass-7f92.drbegapunk97.workers.dev`。`frontend/wrangler.jsonc` 固定了原 Worker 名称和账号 ID；Wrangler 4.168.0 已作为项目开发依赖锁定。本机使用现有 Node.js，不使用 Docker，也不开通 Cloudflare 付费服务。

1. 在 `frontend` 目录运行 `npm run build` 与 `npm run smoke:connectivity`（后者需要先在端口 9400 启动 `wrangler dev --ip 127.0.0.1 --port 9400`）。
2. 运行 `wrangler whoami`，确认登录 `drbegapunk97` 账号。用 `wrangler deployments list --name misty-grass-7f92 --json` 和 `wrangler versions view <版本ID> --name misty-grass-7f92 --json` 核对原版本。原部署只有静态资源，没有其他绑定。版本与备份位置见 [部署记录](CLOUDFLARE-DEPLOYMENT-RECORD.md)。
3. 运行 `wrangler deploy --dry-run --outdir ../.tmp-gen/cloudflare-predeploy/dry-run-primary --keep-vars`，确认 `CONNECTIVITY` 和 `ASSETS` 绑定、静态资源及脚本打包成功。
4. 在 `frontend` 目录运行 `wrangler deploy --keep-vars` 更新**同名原 Worker**。`--keep-vars` 防止 Dashboard 中可能存在的普通环境变量被清空；本次预检读取到的原版本绑定列表为空。
5. 部署成功后打开 `https://misty-grass-7f92.drbegapunk97.workers.dev/network-test`，点击“开始测试”。应显示 HTTP 200 和“两端互发并收到回传”。再在中国大陆无 VPN 的移动网络和家用宽带分别测试；记录地点、运营商、时间、页面结果和浏览器控制台错误即可，**不要发送私人消息**。

**回退限制：**首次新增 Durable Object 类是生命周期变更，Cloudflare 不允许用普通 `wrangler rollback` 跨回旧版本。部署前已保存原静态文件和可重部署的恢复配置；如需恢复旧页面，应使用备份包中的 `fallback-wrangler.jsonc` 重新部署静态快照，同时保留已经创建的 SQLite 类。详见[部署记录](CLOUDFLARE-DEPLOYMENT-RECORD.md)与[官方回滚说明](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)。

只有第 5 步在目标网络实际成功，才能判断该网络下可达。电脑本机测试和 Cloudflare 部署成功都不能替代中国大陆无 VPN 实测。测试页面使用与网页相同的域名，因此结果对应当前打开的域名；浏览器离线缓存可能保留旧网页，测试时可刷新页面并确认 `/api/health` 返回 JSON。

## 免费套餐边界

截至 2026-11-26，Cloudflare 官方文档列出的主要额度如下；发布前应以账户后台和官方文档为准：

| 项目 | Workers Free 限额 | 本阶段影响 |
| --- | --- | --- |
| Worker 动态请求 | 100,000 次/天，单次 CPU 10 ms | `/api/health` 与 WebSocket 握手会消耗额度 |
| Worker 静态资源 | 每版本 20,000 个文件，单文件 25 MiB | 当前最大 WASM 约 7.8 MB，低于单文件上限 |
| Durable Objects | 仅支持 SQLite 后端；请求 100,000 次/天，活跃时长 13,000 GB-s/天 | WebSocket 连接与入站消息计入对象请求；本实现使用休眠 WebSocket API |
| Durable Object SQLite | 读取 500 万行/天、写入 10 万行/天、账户总存储 5 GB | 本阶段不读写数据库；未来正式聊天须重新估算 |

超出免费额度后，相应操作可能报错；WebSocket 可连接并不代表高并发或长期稳定可用。R2、D1、通话和未来的消息规模需要单独核对额度。

官方资料：[Workers 限额](https://developers.cloudflare.com/workers/platform/limits/) · [Durable Objects 计费](https://developers.cloudflare.com/durable-objects/platform/pricing/) · [Durable Objects 限额](https://developers.cloudflare.com/durable-objects/platform/limits/) · [Static Assets 与 Worker 路由](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/) · [Workers 托管构建](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
