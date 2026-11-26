# Aether M4 加密附件状态报告

> 2026-11-23：实现与静态门禁已完成；真实双浏览器门禁已写入
> 原门禁写入 `frontend/e2e/live-e2ee.mjs`；现已取消 Docker 运行方案，需改用两个
> 专用远程 Matrix 测试账号执行，不得把旧本机栈结果套用于任意第三方 homeserver。
> 在该门禁通过前不得宣称 M4 完成或已与 Element 互操作。

## 已实现

- Matrix `EncryptedFile` v2：AES-256-CTR（随机 64 位 nonce + 64 位计数器）、SHA-256 密文完整性校验、JWK `A256CTR` 密钥描述符。
- 图片、文件、语音在浏览器本地加密；仅上传 `application/octet-stream` 密文且不携带上传文件名。
- 文件名、MIME、大小、密钥、IV、摘要和 MXC URI 只进入 Megolm 加密的房间事件。
- 下载先校验 SHA-256，再解密；摘要不匹配 fail-closed。语音由用户点击后在本机解密播放。
- `MediaRecorder` 录音最长 60 秒；空文件与超过 20 MiB 的文件拒绝发送。

## 已执行证据

- `npm run typecheck`：通过。
- `npm test -- --run`：40/40，通过；其中附件往返、篡改拒绝、每次新密钥/IV 共 3 项。
- `npm run build`：通过。
- `npm run smoke`：38/38，通过（含免安装 homeserver 输入与 HTTPS 门禁）。
- `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。

## 待执行的安全门禁

旧自托管门禁会验证：媒体仓库字节不等于且不包含原文件、服务器时间线
只出现 `m.room.encrypted` 且不含文件名/明文、第二浏览器下载后逐字节等于原文件。
现行方案需先改造成凭据由环境变量注入的远程门禁；还需补做 Element 互操作、
大文件/进度、iOS 真机录音格式验证。
