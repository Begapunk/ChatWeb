import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 隔离外部 SDK：单元测试只验证 MatrixService 自身的安全边界与状态机，
// 不加载 WASM、不连网络。真实 SDK 行为由 e2e/live-e2ee.mjs 双浏览器验收覆盖。
vi.mock("matrix-js-sdk", () => ({
  MsgType: { Text: "m.text" },
  EventType: { RoomMessage: "m.room.message" },
  ClientEvent: { Sync: "sync" },
  RoomEvent: { Timeline: "Room.timeline" },
  createClient: vi.fn(),
}));
vi.mock("@matrix-org/matrix-sdk-crypto-wasm", () => ({ initAsync: vi.fn() }));

import {
  MatrixService,
  clearLiveSession,
  hadLiveSession,
  markLiveSession,
  matrixServiceStatus,
  resetLiveStatus,
} from "./matrix";

function makeStorage(): Storage & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    dump: () => Object.fromEntries(map),
  };
}

let storage: ReturnType<typeof makeStorage>;

beforeEach(() => {
  storage = makeStorage();
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("window", {
    location: { origin: "http://127.0.0.1:4173" },
    setInterval: vi.fn(() => 0),
    clearInterval: vi.fn(),
    setTimeout: vi.fn((fn: () => void) => {
      fn();
      return 0;
    }),
    clearTimeout: vi.fn(),
  });
  resetLiveStatus();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("会话标记：只记非敏感布尔值，绝不持久化凭据", () => {
  it("markLiveSession 写入唯一标记，内容不含 token / 口令 / 密钥", () => {
    markLiveSession();
    const dumped = JSON.stringify(storage.dump());
    expect(hadLiveSession()).toBe(true);
    expect(Object.keys(storage.dump())).toEqual(["aether.live-session"]);
    expect(storage.getItem("aether.live-session")).toBe("1");
    for (const secret of ["access_token", "password", "storageKey", "device_id", "secret"]) {
      expect(dumped.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it("clearLiveSession 后 hadLiveSession 为 false", () => {
    markLiveSession();
    clearLiveSession();
    expect(hadLiveSession()).toBe(false);
    expect(storage.getItem("aether.live-session")).toBeNull();
  });

  it("存储不可用（隐私模式抛错）时标记函数不崩溃", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => markLiveSession()).not.toThrow();
    expect(() => clearLiveSession()).not.toThrow();
    expect(hadLiveSession()).toBe(false);
  });

  it("resetLiveStatus 完整复位为演示态，不残留 live / e2ee 假象", () => {
    markLiveSession();
    matrixServiceStatus.mode = "live";
    matrixServiceStatus.connected = true;
    matrixServiceStatus.e2ee = true;
    matrixServiceStatus.cryptoReady = true;
    matrixServiceStatus.userId = "@u:aether.local";
    matrixServiceStatus.deviceId = "DEV";
    matrixServiceStatus.phase = "ready";
    matrixServiceStatus.error = "boom";

    resetLiveStatus();

    expect(matrixServiceStatus).toMatchObject({
      mode: "demo",
      connected: false,
      e2ee: false,
      cryptoReady: false,
      userId: "",
      deviceId: "",
      phase: "idle",
      error: "",
    });
    expect(matrixServiceStatus.reason).toContain("演示模式");
  });
});

describe("房间加密判定：严格依据 m.room.encryption，不用客户端能力兜底", () => {
  function fakeRoom(hasEncryptionState: boolean) {
    return {
      roomId: "!room:aether.local",
      getMyMembership: () => "join",
      getJoinedMembers: () => [
        { userId: "@me:aether.local" },
        { userId: "@peer:aether.local" },
      ],
      name: "测试房间",
      currentState: {
        getStateEvents: (type: string) => (hasEncryptionState && type === "m.room.encryption" ? {} : null),
      },
      getUnreadNotificationCount: () => 0,
      timeline: [],
    };
  }

  function serviceWithRoom(room: unknown): MatrixService {
    const svc = new MatrixService();
    // 注入最小 client 替身：getConversations 只用到这几个方法。
    (svc as unknown as { client: unknown }).client = {
      getCrypto: () => ({}), // 加密层存在，但不能据此判定房间已加密
      getUserId: () => "@me:aether.local",
      getRooms: () => [room],
      getRoom: () => room,
    };
    return svc;
  }

  it("有 m.room.encryption 状态事件 → encrypted=true", () => {
    const [conv] = serviceWithRoom(fakeRoom(true)).getConversations();
    expect(conv.encrypted).toBe(true);
  });

  it("无加密状态事件但 crypto 层就绪 → 仍为 false（不得误报 E2EE）", () => {
    const [conv] = serviceWithRoom(fakeRoom(false)).getConversations();
    expect(conv.encrypted).toBe(false);
  });

  it("未连接时返回空列表，不产生假会话", () => {
    expect(new MatrixService().getConversations()).toEqual([]);
  });
});

describe("加密就绪门禁：超时拒绝发送，绝不降级为明文", () => {
  function serviceWithCrypto(cryptoApi: unknown | undefined): {
    svc: MatrixService;
    sendEvent: ReturnType<typeof vi.fn>;
  } {
    const svc = new MatrixService();
    const sendEvent = vi.fn(async () => ({ event_id: "$sent" }));
    (svc as unknown as { client: unknown }).client = {
      getCrypto: () => cryptoApi,
      getUserId: () => "@me:aether.local",
      getRoom: () => ({ getJoinedMembers: () => [{ userId: "@peer:aether.local" }] }),
      sendEvent,
    };
    return { svc, sendEvent };
  }

  it("加密层缺失 → 立即拒绝，且 sendEvent 从未被调用", async () => {
    const { svc, sendEvent } = serviceWithCrypto(undefined);
    await expect(svc.sendText("!room:aether.local", "明文绝不能外发")).rejects.toThrow(
      /加密层未就绪|不会发送明文/,
    );
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it("房间加密配置一直未就绪 → 有界超时取消发送，不发明文", async () => {
    const cryptoApi = {
      isEncryptionEnabledInRoom: vi.fn(async () => false),
      getUserDeviceInfo: vi.fn(),
    };
    const { svc, sendEvent } = serviceWithCrypto(cryptoApi);
    await expect(svc.waitForEncryptionReady("!room:aether.local", 1200)).rejects.toThrow(
      /加密会话尚未就绪|未发送任何明文/,
    );
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it("就绪后正常发送，内容按 Matrix 规范构造", async () => {
    const cryptoApi = {
      isEncryptionEnabledInRoom: vi.fn(async () => true),
      getUserDeviceInfo: vi.fn(async () => new Map([["@peer:aether.local", new Map([["DEV", {}]])]])),
    };
    const { svc, sendEvent } = serviceWithCrypto(cryptoApi);
    const id = await svc.sendText("!room:aether.local", "hello", "$reply");
    expect(id).toBe("$sent");
    expect(sendEvent).toHaveBeenCalledTimes(1);
    const [, , content] = sendEvent.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(content).toMatchObject({ msgtype: "m.text", body: "hello" });
    expect(content["m.relates_to"]).toEqual({ "m.in_reply_to": { event_id: "$reply" } });
  });

  it("非竞态错误立即抛出且不重试，避免重复发送", async () => {
    const cryptoApi = {
      isEncryptionEnabledInRoom: vi.fn(async () => true),
      getUserDeviceInfo: vi.fn(async () => new Map([["@peer:aether.local", new Map([["DEV", {}]])]])),
    };
    const { svc } = serviceWithCrypto(cryptoApi);
    const sendEvent = vi.fn(async () => {
      throw new Error("M_FORBIDDEN");
    });
    (svc as unknown as { client: { sendEvent: unknown } }).client.sendEvent = sendEvent;

    await expect(svc.sendText("!room:aether.local", "hello")).rejects.toThrow("M_FORBIDDEN");
    expect(sendEvent).toHaveBeenCalledTimes(1);
  });

  it("仅对 unconfigured room 竞态做有界重试，不会无限重发", async () => {
    const cryptoApi = {
      isEncryptionEnabledInRoom: vi.fn(async () => true),
      getUserDeviceInfo: vi.fn(async () => new Map([["@peer:aether.local", new Map([["DEV", {}]])]])),
    };
    const { svc } = serviceWithCrypto(cryptoApi);
    const sendEvent = vi.fn(async () => {
      throw new Error("Cannot encrypt event in unconfigured room !room:aether.local");
    });
    (svc as unknown as { client: { sendEvent: unknown } }).client.sendEvent = sendEvent;

    await expect(svc.sendText("!room:aether.local", "hello")).rejects.toThrow(/unconfigured room/);
    expect(sendEvent).toHaveBeenCalledTimes(3);
  });
});

describe("消息映射：密文标记与 UTD 处理", () => {
  function serviceWithEvent(ev: unknown): MatrixService {
    const svc = new MatrixService();
    (svc as unknown as { client: unknown }).client = {
      getUserId: () => "@me:aether.local",
      getRoom: () => ({ timeline: [ev] }),
    };
    return svc;
  }

  function baseEvent(overrides: Record<string, unknown> = {}) {
    return {
      getId: () => "$evt",
      getType: () => "m.room.message",
      getWireType: () => "m.room.encrypted",
      getWireContent: () => ({ algorithm: "m.megolm.v1.aes-sha2", ciphertext: "cipher" }),
      getContent: () => ({ msgtype: "m.text", body: "hello" }),
      isDecryptionFailure: () => false,
      isRedacted: () => false,
      getSender: () => "@peer:aether.local",
      getTs: () => 1700000000000,
      ...overrides,
    };
  }

  it("原始事件为 m.room.encrypted → 消息标记 encrypted=true", () => {
    const [msg] = serviceWithEvent(baseEvent()).getMessages("!room:aether.local");
    expect(msg.encrypted).toBe(true);
    expect(msg.body).toBe("hello");
  });

  it("解密失败显示 UTD 占位，不泄露密文", () => {
    const [msg] = serviceWithEvent(
      baseEvent({ isDecryptionFailure: () => true, getContent: () => ({ ciphertext: "cipher" }) }),
    ).getMessages("!room:aether.local");
    expect(msg.body).toContain("无法解密");
    expect(msg.body).not.toContain("cipher");
  });

  it("撤回事件映射为 revoked，不带正文", () => {
    const [msg] = serviceWithEvent(baseEvent({ isRedacted: () => true, getContent: () => ({}) })).getMessages(
      "!room:aether.local",
    );
    expect(msg.revoked).toBe(true);
  });
});
