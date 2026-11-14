/**
 * M2 剩余工程：真实 MatrixService 的契约占位（**未实现**）。
 *
 * 当前 demo 由 src/stores/chat.ts 的本地内存数据驱动：不建立网络连接、
 * 不调用 matrix-js-sdk、不初始化 Rust Crypto WASM、不产生任何密钥。
 * 因此 UI 上出现的「加密」字样仅表示未来接入 Matrix 后的目标状态，
 * 绝不代表当前消息已被端到端加密。
 *
 * 实现前必须核对安装版 matrix-js-sdk 45.1.0 的 .d.ts，并复用 M0 已审计事实
 * （docs/DEPENDENCIES.md §6）：loginWithPassword 返回 device_id 后须重建 client、
 * initRustCrypto 的 32 字节 storageKey、WASM 资源路径固定、首次发送前等待对端设备可见。
 * 严禁凭记忆编写 SDK API。
 */
export interface MatrixSessionConfig {
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  /** 32 字节；派生自用户凭据并经 SSSS，绝不写入日志或持久化明文。 */
  storageKey: Uint8Array;
}

export interface MatrixServiceContract {
  loginWithPassword(userId: string, password: string): Promise<MatrixSessionConfig>;
  initCrypto(session: MatrixSessionConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendText(roomId: string, body: string): Promise<void>;
}

export const matrixServiceStatus = {
  implemented: false,
  connected: false,
  e2ee: false,
  reason: "演示模式：未连接 Synapse、未初始化 Rust Crypto WASM，消息为本地模拟数据",
} as const;
