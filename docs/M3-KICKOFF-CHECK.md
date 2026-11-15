# M3 开工首检：跨签名 / 密钥备份恢复 SDK API 实证核对

> 日期：2026-11-15 · 执行：主理人自行完成（Codex 子 Agent 仍按用户通知保持禁用，未调用）
> 目的：M3 涉及恢复密钥、SSSS、跨签名、设备撤销等**高安全敏感** API，禁止凭记忆编写。
> 本轮逐一核对**已安装 `matrix-js-sdk 45.1.0`** 的 `.d.ts` 与 JS 源码，并复核 M0 T05 已跑通代码。
> 结论：**恢复链路必须走 `cryptoCallbacks.getSecretStorageKey`，不能靠 `bootstrapSecretStorage` 的
> `createSecretStorageKey` 参数**（源码已证实），详见 §3。

---

## 1. 核对范围与证据位置

所有路径相对 `frontend/node_modules/matrix-js-sdk/lib/`。

| 主题 | 证据文件 |
|---|---|
| CryptoApi 接口 | `crypto-api/index.d.ts` |
| 恢复密钥编解码 | `crypto-api/recovery-key.d.ts` / `recovery-key.js` |
| 备份恢复结果类型 | `crypto-api/keybackup.d.ts` |
| Rust Crypto 实现 | `rust-crypto/rust-crypto.js`、`rust-crypto/CrossSigningIdentity.js` |
| SSSS 回调契约 | `secret-storage.js` |
| 设备列表 / 撤销 | `client.d.ts:3132,3161` |
| 设备验证状态类型 | `models/device.d.ts` |
| UIA 回调签名 | `interactive-auth.d.ts:115` |
| M0 已验证引导序列 | `m0/src/t05-synapse-e2ee.mjs:220-241` |

## 2. 精确签名（禁止改写）

```ts
// createClient 选项（client.d.ts:224）
cryptoCallbacks?: CryptoCallbacks;

// crypto-api/index.d.ts:1003
getSecretStorageKey?: (opts: {
  keys: Record<string, SecretStorageKeyDescription>;
}, name: string) => Promise<[string, Uint8Array<ArrayBuffer>] | null>;

// crypto-api/index.d.ts:749
interface BootstrapCrossSigningOpts {
  setupNewCrossSigning?: boolean;
  authUploadDeviceSigningKeys?: UIAuthCallback<void>;  // (makeRequest) => Promise<void>
}

// crypto-api/index.d.ts:1052
interface CreateSecretStorageOpts {
  createSecretStorageKey?: () => Promise<GeneratedSecretStorageKey>;
  setupNewKeyBackup?: boolean;
  setupNewSecretStorage?: boolean;
}

// crypto-api/index.d.ts:1096
interface GeneratedSecretStorageKey {
  keyInfo?: { passphrase?: PassphraseInfo; name?: string };
  privateKey: Uint8Array<ArrayBuffer>;
  encodedPrivateKey?: string;
}

createRecoveryKeyFromPassphrase(password?: string): Promise<GeneratedSecretStorageKey>;
getKeyBackupInfo(): Promise<KeyBackupInfo | null>;
getActiveSessionBackupVersion(): Promise<string | null>;
loadSessionBackupPrivateKeyFromSecretStorage(): Promise<void>;
storeSessionBackupPrivateKey(key: Uint8Array, version: string): Promise<void>;
restoreKeyBackup(opts?: KeyBackupRestoreOpts): Promise<KeyBackupRestoreResult>; // { total, imported }
restoreKeyBackupWithPassphrase(passphrase, opts?): Promise<KeyBackupRestoreResult>; // ⚠️ @deprecated
checkKeyBackupAndEnable(): Promise<KeyBackupCheck | null>;
isCrossSigningReady(): Promise<boolean>;
isSecretStorageReady(): Promise<boolean>;
getCrossSigningStatus(): Promise<CrossSigningStatus>;
getSecretStorageStatus(): Promise<SecretStorageStatus>;
getUserDeviceInfo(userIds: string[], downloadUncached?: boolean): Promise<DeviceMap>;
setDeviceVerified(userId, deviceId, verified?): Promise<void>;
crossSignDevice(deviceId: string): Promise<void>;
requestOwnUserVerification(): Promise<VerificationRequest>;
requestDeviceVerification(userId, deviceId): Promise<VerificationRequest>;

// recovery-key.d.ts
encodeRecoveryKey(key: ArrayLike<number>): string | undefined;
decodeRecoveryKey(recoveryKey: string): Uint8Array<ArrayBuffer>;

// client.d.ts
getDevices(): Promise<{ devices: IMyDevice[] }>;
deleteDevice(deviceId: string, auth?: AuthDict): Promise<EmptyObject>;

// models/device.d.ts
enum DeviceVerification { Blocked = -1, Unverified = 0, Verified = 1 }
type DeviceMap = Map<string, Map<string, Device>>;
class Device {
  readonly deviceId: string; readonly userId: string;
  readonly verified: DeviceVerification;
  readonly displayName?: string;
  getFingerprint(): string | undefined;
  getIdentityKey(): string | undefined;
}
```

**关键事实**：
- `restoreKeyBackupWithPassphrase` 已标注 `@deprecated`，注释明确「口令派生备份密钥不是 Matrix 规范」。
  → **M3 采用随机生成的 SSSS 恢复密钥（4S）**，不用口令派生备份密钥。
- `encodeRecoveryKey` 产出带前缀 `0x8b 0x01` + 奇偶校验位的 base58 字符串，每 4 字符空格分组；
  `decodeRecoveryKey` 会校验 parity / prefix / 长度（32 字节）。→ 用户输入错误可本地即时拒绝。
- `getUserDeviceInfo` 第二参默认 `false`（M2-R D4 已踩过），列真实设备同样必须传 `true`。
- `UIAuthCallback<T> = (makeRequest: (authData) => Promise<T>) => Promise<T>`；
  M0 T05 实证用 `m.login.password` + `{type:"m.id.user", user}` + 密码。

## 3. 恢复链路的源码级结论（本轮最重要的发现）

`rust-crypto/rust-crypto.js:726-762` 的 `bootstrapSecretStorage` 实现：

```js
const isNewSecretStorageKeyNeeded = setupNewSecretStorage || !(await this.secretStorageHasAESKey());
if (isNewSecretStorageKeyNeeded) {
  // 只有「服务端尚无 SSSS key」或强制重置时才调用 createSecretStorageKey
  const recoveryKey = await createSecretStorageKey();
  await this.addSecretStorageKeyToSecretStorage(recoveryKey);
}
```

**推论**：设备清除浏览器数据后重新登录时，服务端**已经存在** SSSS 默认 key，
因此 `bootstrapSecretStorage({ createSecretStorageKey })` **不会**调用该回调，
用户手里的恢复密钥根本没被交给 SDK —— 这是最容易写错、且表面「不报错但恢复失败」的陷阱。

正确恢复路径（已由源码交叉验证）：

1. `decodeRecoveryKey(encoded)` → 32 字节私钥；
2. **在 `createClient` 时**注入 `cryptoCallbacks.getSecretStorageKey`，
   回调从 `opts.keys` 取服务端默认 keyId，返回 `[keyId, privateKey]`
   （`secret-storage.js:366-379` 会校验 `keys[keyId]` 存在，否则抛 `App returned unknown key`）；
3. `crypto.loadSessionBackupPrivateKeyFromSecretStorage()`：
   从 SSSS 读 `m.megolm_backup.v1`，与服务器备份版本比对签名，
   匹配则 `saveBackupDecryptionKey`（`rust-crypto.js:1059-1072`）；
4. `crypto.restoreKeyBackup()` 下载并导入历史 Megolm 会话密钥，返回 `{total, imported}`；
5. `crypto.bootstrapCrossSigning({authUploadDeviceSigningKeys})`：
   `CrossSigningIdentity.js:38-42` 会先从 SSSS 读
   `m.cross_signing.master / user_signing / self_signing` 恢复身份；
6. 本地历史消息由 SDK 重新解密（M0 F3：timeline 可能早于解密完成，需轮询复核）。

**架构影响**：`cryptoCallbacks` 是 `createClient` 的构造期选项，不能在连接后追加。
而 M0 F2 已实证「同一实例 `stopClient()+startClient()` 不会重启 rust-crypto 请求循环」，
所以「在设置页导入恢复密钥」必须**新建客户端实例**（复用同一 `cryptoDatabasePrefix`），
不能原地改回调。M3 的实现需把恢复密钥作为**连接参数**传入 `MatrixService.connect()`，
在安全中心触发恢复时执行「停止 → 用同凭据 + recoveryKey 重建 → 恢复 → 重新 sync」。

## 4. 首次引导序列（M0 T05 已真实跑通，可直接沿用）

`m0/src/t05-synapse-e2ee.mjs:220-241`：

```js
await crypto.bootstrapCrossSigning({
  authUploadDeviceSigningKeys: async (makeRequest) => {
    await makeRequest({ type: "m.login.password",
      identifier: { type: "m.id.user", user: aliceName }, password: alicePass });
  },
});
// 断言 isCrossSigningReady() === true；服务器 keys/query 返回 master_keys
const ssssKey = /* 32 字节 */;
await crypto.bootstrapSecretStorage({
  setupNewKeyBackup: true,
  createSecretStorageKey: async () => ({
    keyInfo: { name: "Aether M0 recovery" },
    privateKey: ssssKey,
    encodedPrivateKey: encodeRecoveryKey(ssssKey),
  }),
});
// 断言 isSecretStorageReady() / getKeyBackupInfo().version 存在
```

**M0 未验证的部分（M3 必须补）**：
- 清除浏览器数据 → 用恢复密钥恢复 → **历史消息确实重新解密**；
- 未备份 / 错误恢复密钥时**确实无法解密**（fail-closed）；
- 撤销设备后密钥不再分发；
- 恢复密钥是否泄露到日志 / localStorage / DOM 持久化。

## 5. 安全红线在 M3 的具体落实

| 红线 | 落实方式 |
|---|---|
| 恢复密钥不得落日志 | 只在内存中短暂存在，展示一次后由 UI 清除；SDK logger 级别保持默认；E2E 断言 console / 网络日志不含恢复密钥原文 |
| 恢复密钥不得写 localStorage / sessionStorage | 仅作为 `connect()` 参数与内存变量；验收用 `getAllStorage` 断言 |
| 恢复密钥不得进 SW 缓存 | 现有 `runtimeCaching: []` 与 API 路径 denylist 已覆盖 |
| 口令只在内存 | 沿用 M2-R；UIA 用的密码直接从内存凭据取，不新增持久化 |
| 不把 TLS 当 E2EE | 报告只以「备份密文 + 恢复后本地解密成功」为证据 |
| 安全相关失败阻断 | 恢复 / 撤销 / 验证任一断言失败，M3 不得进入 M4 |

## 6. 结论与实施路径

1. `services/matrix.ts` 扩展：`cryptoCallbacks` 注入点、引导、恢复、安全状态、真实设备列表、
   验证 / 撤销；`LiveCredentials` 增加可选 `recoveryKey`。
2. `views/SettingsView.vue` 安全中心 / 设备页换成真实数据；新增恢复密钥生成与导入流程、
   清数据前强警告；删除 demo 假设备列表在 live 模式的迷惑性展示。
3. 新增 `e2e/m3-recovery.mjs`：双浏览器真实 Synapse，清 IndexedDB → 恢复 → 历史解密；
   错误密钥 fail-closed；设备撤销后密钥不再分发。
4. 单元测试覆盖恢复密钥解码校验、状态汇总、回调 keyId 合法性。
5. 文档联动与提交；全部通过后自动进入 M4。

> 仍**不宣称完成**：emoji/QR 交互式 SAS 验证的完整双设备交互、设备脱水泵渴（dehydrated device）、
> `onlyAllowTrustedDevices` 策略评估留待 M3 验收结论后判断，不提前写入「已完成」。
