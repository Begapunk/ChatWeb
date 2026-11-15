/**
 * M3 安全逻辑单元测试：恢复密钥校验、状态汇总、设备合并、清数据警告。
 * 纯逻辑，不依赖 DOM / Synapse；真实 SDK 行为由 e2e/m3-recovery.mjs 覆盖。
 */
import { describe, expect, it, vi } from "vitest";
import { encodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";
import {
  dataLossWarning,
  decodeUserRecoveryKey,
  formatGeneratedRecoveryKey,
  mergeDeviceInfo,
  normalizeRecoveryKey,
  prettyRecoveryKey,
  summarizeSecurity,
  toDeviceTrust,
} from "./security";
import { DeviceVerification } from "matrix-js-sdk/lib/models/device.js";

const KEY_BYTES = new Uint8Array(32);
for (let i = 0; i < 32; i += 1) KEY_BYTES[i] = (i * 7 + 3) & 0xff;

describe("恢复密钥", () => {
  it("normalizeRecoveryKey 去掉空格/换行/连字符", () => {
    expect(normalizeRecoveryKey("  Ab Cd-\neF\n ")).toBe("AbCdeF");
  });

  it("SDK 生成的合法恢复密钥可被解码为 32 字节且与原文一致", () => {
    const encoded = formatGeneratedRecoveryKey(KEY_BYTES);
    const decoded = decodeUserRecoveryKey(encoded);
    expect(decoded.length).toBe(32);
    expect(Array.from(decoded)).toEqual(Array.from(KEY_BYTES));
  });

  it("带任意空白/连字符的恢复密钥仍能解码", () => {
    const encoded = formatGeneratedRecoveryKey(KEY_BYTES);
    const mangled = encoded.replace(/ /g, "\n-");
    expect(Array.from(decodeUserRecoveryKey(mangled))).toEqual(Array.from(KEY_BYTES));
  });

  it("prettyRecoveryKey 每 4 字符分组", () => {
    expect(prettyRecoveryKey("abcdefghij")).toBe("abcd efgh ij");
  });

  it("空输入 / 非法字符 / 校验位错误都本地拒绝，且错误信息不回显输入", () => {
    expect(() => decodeUserRecoveryKey("   ")).toThrow("请输入恢复密钥");
    expect(() => decodeUserRecoveryKey("0OIl")).toThrow("非法字符");
    expect(() => decodeUserRecoveryKey("1111111111111111111111111111111111111111111111")).toThrow(
      /校验失败|格式无效/,
    );
    const encoded = encodeRecoveryKey(KEY_BYTES) ?? "";
    const broken = encoded.slice(0, -1) + (encoded.endsWith("1") ? "2" : "1");
    expect(() => decodeUserRecoveryKey(broken)).toThrow(/校验失败|格式无效/);
  });

  it("恢复密钥处理链路不调用任何持久化存储 API（运行时 spy）", () => {
    const setItem = vi.fn();
    const getItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem, getItem, removeItem: vi.fn() });
    vi.stubGlobal("sessionStorage", { setItem, getItem, removeItem: vi.fn() });
    try {
      const encoded = formatGeneratedRecoveryKey(KEY_BYTES);
      decodeUserRecoveryKey(encoded);
      normalizeRecoveryKey(encoded);
      prettyRecoveryKey(encoded);
      expect(setItem).not.toHaveBeenCalled();
      expect(getItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("安全状态汇总", () => {
  const base = {
    crossSigningReady: true,
    secretStorageReady: true,
    backupVersion: "v1",
    backupKeyCount: 12,
    backupActiveVersion: "v1",
    restoredKeys: 0,
  };

  it("备份版本与活动版本一致才算自动备份中", () => {
    expect(summarizeSecurity(base).backupActive).toBe(true);
    expect(summarizeSecurity({ ...base, backupActiveVersion: null }).backupActive).toBe(false);
  });

  it("recoverable 必须同时满足备份存在与 4S 就绪", () => {
    expect(summarizeSecurity(base).recoverable).toBe(true);
    expect(summarizeSecurity({ ...base, secretStorageReady: false }).recoverable).toBe(false);
    expect(summarizeSecurity({ ...base, backupVersion: null }).recoverable).toBe(false);
  });

  it("restoredThisSession 由导入密钥数决定", () => {
    expect(summarizeSecurity({ ...base, restoredKeys: 5 }).restoredThisSession).toBe(true);
    expect(summarizeSecurity(base).restoredThisSession).toBe(false);
  });

  it("toDeviceTrust 映射 SDK 枚举三态", () => {
    expect(toDeviceTrust(DeviceVerification.Verified)).toBe("verified");
    expect(toDeviceTrust(DeviceVerification.Blocked)).toBe("blocked");
    expect(toDeviceTrust(DeviceVerification.Unverified)).toBe("unverified");
    expect(toDeviceTrust(99)).toBe("unverified");
  });
});

describe("设备合并与清数据警告", () => {
  it("合并服务器展示信息与加密层验证状态，并标记当前设备", () => {
    const fake = {
      verified: DeviceVerification.Verified,
      displayName: "crypto name",
      getFingerprint: () => "FP-123",
    };
    const list = mergeDeviceInfo(
      [
        { device_id: "AAA", display_name: "Alice Phone", last_seen_ts: 1_700_000_000_000 },
        { device_id: "BBB" },
      ],
      new Map([["AAA", fake as never]]),
      "BBB",
    );
    expect(list[0]).toMatchObject({
      id: "AAA",
      name: "Alice Phone",
      trust: "verified",
      current: false,
      fingerprint: "FP-123",
    });
    expect(list[1]).toMatchObject({ id: "BBB", trust: "unverified", current: true });
  });

  it("未备份时警告明确说明永久丢失且无法找回", () => {
    const w = dataLossWarning(
      summarizeSecurity({
        ...{ crossSigningReady: false, secretStorageReady: false, backupVersion: null, backupKeyCount: null, backupActiveVersion: null, restoredKeys: 0 },
      }),
    );
    expect(w).toContain("永久丢失");
    expect(w).toContain("无法找回");
  });

  it("已备份时警告要求离线保存恢复密钥，不承诺服务器可找回", () => {
    const w = dataLossWarning(
      summarizeSecurity({
        crossSigningReady: true,
        secretStorageReady: true,
        backupVersion: "v9",
        backupKeyCount: 3,
        backupActiveVersion: "v9",
        restoredKeys: 0,
      }),
    );
    expect(w).toContain("v9");
    expect(w).toContain("无法帮你找回");
  });
});
