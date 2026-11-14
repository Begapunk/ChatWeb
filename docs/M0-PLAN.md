# Aether M0 验证计划（已执行）

> 本计划于 M0 开始时制定并执行完毕，结果见 M0-VERIFICATION-REPORT.md。

## 目标

在编写任何产品 UI 之前，证明目标技术栈的 E2EE 可行性与 API 真实性：
matrix-js-sdk + Rust Crypto WASM + IndexedDB + Synapse + 两个浏览器设备之间的端到端加密。

## 前置

1. 检查本机环境：Node/Docker/浏览器/网络代理。
2. 从官方 registry/releases 查询并锁定版本（禁止浮动版本、禁止凭记忆）。
3. 安装锁定版 SDK，审计 `.d.ts`：initRustCrypto、CryptoApi、MatrixRTC、附件加密、WASM 绑定。

## 测试矩阵

| 编号 | 层级 | 验证点 | 通过标准 |
|---|---|---|---|
| T01 | Node | WASM 加载；内存/IndexedDB 存储；passphrase 与 32 字节 key 加密；持久化；错误密钥拒绝 | 全部断言通过 |
| T02 | Node | initRustCrypto 离线可用；M2/M3 所需 CryptoApi 方法齐全；MatrixRTC 导出与 join/leave | 全部断言通过 |
| T03 | Node | 双 OlmMachine 模拟服务器密钥分发；Olm to-device 与 Megolm 房间加密往返；密文不含明文；无密钥第三方解密失败 | 全部断言通过 |
| T03b | Node | 规范 EncryptedFile（AES-256-CTR+SHA-256）往返、字段齐全、篡改检测 | 全部断言通过 |
| T04 | Chrome | 真实 IndexedDB/WebCrypto/WASM；initRustCrypto；跨客户端实例持久化；浏览器内双设备 Olm 往返；无控制台错误 | 全部断言通过 |
| T05 | Synapse | 管理员共享密钥注册；官方注册令牌 API；令牌超额拒绝；加密房间；双设备 Megolm 往返；服务器密文证明；非成员访问控制；重启离线补同步；跨签名 UIA；SSSS+密钥备份；恢复密钥 | 全部断言通过 |
| T06 | 双 Chrome | 两个独立浏览器实例（独立存储）经 Synapse 登录、同步、加密发送/解密接收；线路内容无明文 | 全部断言通过 |

## 安全红线（贯穿所有测试）

- 不实现/不发明加密算法；全部使用 SDK 的 Olm/Megolm 与规范附件格式。
- 密码/令牌随机生成、不落日志、不进报告；仅存 gitignore 的本地文件。
- 管理接口仅测试脚本（服务端视角）调用，浏览器不接触管理 Token。
- 任何安全相关断言失败 → M0 不通过，阻止进入 M1。

## 退出标准

全部测试通过 + 验证报告 + 风险清单更新 + 未验证项明确列出 → 等待 M1 授权。