# Aether 免安装运行方案

> 历史方案（2026-11-23）。当前已暂停 Matrix 真实登录，改为 Cloudflare 同源连通性验证；
> 部署与测试请看 [CLOUDFLARE-CONNECTIVITY.md](CLOUDFLARE-CONNECTIVITY.md)。以下内容仅供追溯。

## Cloudflare Pages 网页托管

使用 Cloudflare 后台 **Workers & Pages → Create application → Drag and drop your files**，
将构建的 `frontend/dist` 内容以文件夹或 ZIP 形式上传。ZIP 根目录应有 `index.html`、
`_headers`、`sw.js` 和 `wasm/`。构建只需用现有依赖在 `frontend` 下执行
`npm run prepare:wasm` 和 `npm run build`。

发布后打开 Cloudflare 提供的 `pages.dev` 地址，在 `/login` 选择「连接真实服务器」。
默认使用 `https://matrix-client.matrix.org`。先在 Element 网页版选择 `matrix.org`
注册账号、设置密码，并创建或加入仅邀请的加密房间。Pages 提供前端静态文件，浏览器直接
与 Matrix.org 通讯。使用本机版时保存的设备密钥不会自动迁移到新域名。

## 运行方式

双击项目根目录的 `start-aether.cmd`。脚本只使用电脑已有的 Node.js：

1. 从当前已安装依赖构建前端，不执行 `npm install` / `npm ci`；
2. 用 Node.js 内置 HTTP 模块在 `127.0.0.1:4173` 提供 PWA 与 SPA fallback；
3. 浏览器打开该地址后，可进入演示模式，或填写现有 Matrix homeserver 与账号登录。

命令行等价操作：

```powershell
node scripts/start-local.mjs
```

## 真实通讯边界

- 本机不再运行 Synapse、PostgreSQL、Caddy 或邀请服务。
- 真实模式直接连接用户填写的标准 Matrix homeserver；必须使用 HTTPS，只有 localhost
  允许 HTTP。服务器必须开放标准 Matrix Client API 的浏览器 CORS。
- 账号需事先由所选 Matrix 服务商创建。本项目不再提供本机邀请码注册。
- Olm/Megolm、Rust Crypto WASM、密钥备份与 EncryptedFile 仍在浏览器端运行；不改成
  自研加密协议，也不把演示模式描述成安全聊天。
- homeserver 会看到账号、房间成员、时间、流量和密文等元数据；E2EE 不隐藏这些元数据。

## 零安装条件下无法提供的能力

- 私有自托管 Matrix 服务端及其一次性邀请码管理；
- 不依赖外部服务的跨设备消息转发、离线消息和 Web Push；
- LiveKit/TURN 通话服务；
- 对第三方 homeserver 可用性、日志策略、备份策略和账号注册政策的控制。

旧 Docker/Compose 服务端代码保留为历史实现和可选部署资料，但不再是现行运行路径，
也不会被 `start-aether.cmd` 调用。
