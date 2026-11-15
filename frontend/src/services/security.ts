/**
 * M3 安全中心：纯逻辑层（不依赖 DOM / SDK，便于单测）。
 *
 * 恢复密钥是 Matrix 规范 Cryptographic key representation：
 *   base58( 0x8B 0x01 || 32-byte key || 1-byte parity )，展示时每 4 字符空格分组。
 * 见安装版 matrix-js-sdk 45.1.0 `lib/crypto-api/recovery-key.js`。
 *
 * 安全红线：本模块只做「格式规范化 / 校验 / 状态汇总」，**绝不持久化**恢复密钥，
 * 也不把恢复密钥写入任何日志字段。真正的编解码由 SDK 的
 * `decodeRecoveryKey` / `encodeRecoveryKey` 完成，避免自研密码学。
 */
import { decodeRecoveryKey, encodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";
import { DeviceVerification } from "matrix-js-sdk/lib/models/device.js";
import type { Device } from "matrix-js-sdk/lib/models/device.js";

/** 用户粘贴时可能带空格、换行、连字符，统一归一化为 SDK 可接受形态。 */
export function normalizeRecoveryKey(input: string): string {
  return input.replace(/\s+/g, "").replace(/-/g, "").trim();
}

/** 展示形态：每 4 字符空格分组，便于人工抄写核对。SDK 生成的形态本身就是这个格式。 */
export function prettyRecoveryKey(input: string): string {
  const raw = normalizeRecoveryKey(input);
  return raw.match(/.{1,4}/g)?.join(" ") ?? raw;
}

/**
 * 校验并解码恢复密钥。任何格式错误都在本地即时拒绝，不发起网络请求。
 * 返回 32 字节私钥；调用方必须在用完后让引用尽快离开作用域，不得持久化。
 */
export function decodeUserRecoveryKey(input: string): Uint8Array<ArrayBuffer> {
  const normalized = normalizeRecoveryKey(input);
  if (!normalized) throw new Error("请输入恢复密钥");
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(normalized)) {
    throw new Error("恢复密钥包含非法字符（应为 Base58 字母数字）");
  }
  let key: Uint8Array<ArrayBuffer>;
  try {
    key = decodeRecoveryKey(normalized);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // SDK 原始报错信息不透出细节，避免把内部结构写进 UI 日志；给出可操作的提示。
    if (/parity|prefix|length|Non-base58/i.test(msg)) {
      throw new Error("恢复密钥校验失败：请检查是否完整抄写（含校验位）");
    }
    throw new Error("恢复密钥格式无效");
  }
  if (key.length !== 32) throw new Error("恢复密钥长度不正确（应为 32 字节）");
  return key;
}

/** 用 SDK 规范实现生成随机恢复密钥的展示串。仅用于首次引导。 */
export function formatGeneratedRecoveryKey(privateKey: Uint8Array): string {
  const encoded = encodeRecoveryKey(privateKey);
  if (!encoded) throw new Error("恢复密钥编码失败");
  return encoded;
}

/** 把 SDK 的 DeviceVerification 枚举收敛成 UI 需要的三态。 */
export type DeviceTrust = "verified" | "unverified" | "blocked";

export function toDeviceTrust(verified: number): DeviceTrust {
  if (verified === DeviceVerification.Verified) return "verified";
  if (verified === DeviceVerification.Blocked) return "blocked";
  return "unverified";
}

export interface SecurityDevice {
  id: string;
  name: string;
  lastSeen: string;
  trust: DeviceTrust;
  current: boolean;
  fingerprint: string;
}

export interface SecurityStatus {
  /** 跨签名是否已就绪（本地持有私钥）。 */
  crossSigningReady: boolean;
  /** 4S（SSSS）是否就绪。 */
  secretStorageReady: boolean;
  /** 服务器端密钥备份版本；null 表示尚未建立备份。 */
  backupVersion: string | null;
  /** 备份中会话密钥条数；null 表示无法取得。 */
  backupKeyCount: number | null;
  /** 本设备是否正在自动备份。 */
  backupActive: boolean;
  /** 本次会话是否通过恢复密钥找回过历史密钥。 */
  restoredThisSession: boolean;
  /** 恢复导入的密钥数。 */
  restoredKeys: number;
  /** 是否存在可用的恢复手段（有备份版本）。 */
  recoverable: boolean;
}

export function summarizeSecurity(input: {
  crossSigningReady: boolean;
  secretStorageReady: boolean;
  backupVersion: string | null;
  backupKeyCount: number | null;
  backupActiveVersion: string | null;
  restoredKeys: number;
}): SecurityStatus {
  const backupActive =
    input.backupVersion !== null && input.backupActiveVersion === input.backupVersion;
  return {
    crossSigningReady: input.crossSigningReady,
    secretStorageReady: input.secretStorageReady,
    backupVersion: input.backupVersion,
    backupKeyCount: input.backupKeyCount,
    backupActive,
    restoredThisSession: input.restoredKeys > 0,
    restoredKeys: input.restoredKeys,
    // 「可恢复」必须同时满足：服务器确有备份 + 4S 就绪（否则拿不到解密密钥）。
    recoverable: input.backupVersion !== null && input.secretStorageReady,
  };
}

/** 把 SDK Device（含指纹）与服务器 getDevices() 的展示信息合并，供 UI 使用。 */
export function mergeDeviceInfo(
  serverDevices: { device_id: string; display_name?: string; last_seen_ts?: number }[],
  cryptoDevices: Map<string, Device> | undefined,
  currentDeviceId: string,
): SecurityDevice[] {
  return serverDevices.map((d) => {
    const crypto = cryptoDevices?.get(d.device_id);
    const trust = crypto ? toDeviceTrust(crypto.verified) : "unverified";
    return {
      id: d.device_id,
      name: d.display_name || crypto?.displayName || "未命名设备",
      lastSeen: d.last_seen_ts ? new Date(d.last_seen_ts).toLocaleString() : "未知",
      trust,
      current: d.device_id === currentDeviceId,
      fingerprint: crypto?.getFingerprint?.() ?? "",
    };
  });
}

/**
 * 生成给用户的「清除浏览器数据」警告文案。
 * 刻意把「未备份」与「已备份」分开：前者是数据永久丢失，后者仍需提醒恢复密钥离线保存。
 */
export function dataLossWarning(status: SecurityStatus): string {
  if (!status.crossSigningReady || !status.secretStorageReady) {
    return "尚未设置密钥备份：清除浏览器数据会永久丢失本设备的解密密钥，历史消息将无法解密，且无法找回。请先完成密钥备份。";
  }
  if (!status.backupActive) {
    return "密钥备份未处于自动备份状态：新消息可能没有上传备份。请检查安全中心状态后再清除浏览器数据。";
  }
  return `密钥备份已启用（版本 ${status.backupVersion ?? "?"}）。清除浏览器数据后，必须凭离线保存的恢复密钥才能找回历史消息；恢复密钥只显示一次且服务器无法帮你找回。`;
}
