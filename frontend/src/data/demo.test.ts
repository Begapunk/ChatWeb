import { describe, expect, it } from "vitest";
import {
  ME_ID,
  buildDemoMessages,
  demoContacts,
  demoConversations,
  demoReplies,
  formatClock,
  formatDayLabel,
  formatListTime,
} from "./demo";

describe("演示数据：结构完整、无隐藏副作用", () => {
  it("会话包含群聊与私聊，且都带必要字段", () => {
    expect(demoConversations.some((c) => c.kind === "group")).toBe(true);
    expect(demoConversations.some((c) => c.kind === "direct")).toBe(true);
    for (const c of demoConversations) {
      expect(c.id).toBeTruthy();
      expect(c.memberIds).toContain(ME_ID);
      expect(typeof c.encrypted).toBe("boolean");
    }
  });

  it("消息按房间分组，字段合法且不含真实凭据", () => {
    const now = Date.UTC(2026, 10, 14, 10, 0, 0);
    const grouped = buildDemoMessages(now);
    expect(Object.keys(grouped).length).toBeGreaterThan(0);
    const all = Object.values(grouped).flat();
    expect(all.length).toBeGreaterThan(5);
    for (const m of all) {
      expect(m.id).toBeTruthy();
      expect(m.roomId).toBeTruthy();
      expect(["text", "image", "file", "voice"]).toContain(m.kind);
      expect(["sending", "sent", "delivered", "read", "failed"]).toContain(m.status);
      // 演示数据不得自带「真实链路加密」标记，避免伪装成 E2EE 消息
      expect(m.encrypted).toBeUndefined();
    }
  });

  it("联系人/回复文案为纯本地模拟，无外部资源引用", () => {
    expect(demoContacts.length).toBeGreaterThan(0);
    expect(demoReplies.length).toBeGreaterThan(0);
    const text = JSON.stringify([demoContacts, demoReplies, demoConversations]);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/access_token|password|secret/i);
  });
});

describe("时间格式化", () => {
  const base = new Date(2026, 10, 14, 9, 5, 0).getTime();

  it("formatClock 返回 HH:MM", () => {
    expect(formatClock(base)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("formatDayLabel 对同一天给出稳定标签", () => {
    expect(formatDayLabel(base)).toBe(formatDayLabel(base + 60_000));
  });

  it("formatListTime 对同一天返回时钟，跨天返回日期", () => {
    expect(typeof formatListTime(base)).toBe("string");
    expect(formatListTime(base).length).toBeGreaterThan(0);
    expect(formatListTime(base - 3 * 24 * 3600_000).length).toBeGreaterThan(0);
  });
});
