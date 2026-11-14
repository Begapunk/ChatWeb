import type { Contact, Conversation, DeviceItem, Message } from "../types";

export const ME_ID = "@me:aether.local";

export const demoContacts: Contact[] = [
  { id: "@lin:aether.local", name: "林澈", initials: "林", color: "#4fd1c5", online: true, verified: true, role: "管理员" },
  { id: "@zhou:aether.local", name: "周予安", initials: "周", color: "#8b9cf7", online: true, verified: true },
  { id: "@chen:aether.local", name: "陈默", initials: "陈", color: "#f0a35b", online: false, verified: true },
  { id: "@xu:aether.local", name: "许知遥", initials: "许", color: "#e478a8", online: false, verified: false },
];

export const demoConversations: Conversation[] = [
  {
    id: "!team:aether.local", kind: "group", name: "Aether 小队",
    memberIds: [ME_ID, "@lin:aether.local", "@zhou:aether.local", "@chen:aether.local"],
    topic: "端到端加密 · 邀请制", unread: 2, pinned: true, muted: false, encrypted: true,
  },
  {
    id: "!dm-lin:aether.local", kind: "direct", name: "林澈",
    memberIds: [ME_ID, "@lin:aether.local"], topic: "", unread: 1, pinned: false, muted: false, encrypted: true,
  },
  {
    id: "!dm-zhou:aether.local", kind: "direct", name: "周予安",
    memberIds: [ME_ID, "@zhou:aether.local"], topic: "", unread: 0, pinned: false, muted: false, encrypted: true,
  },
  {
    id: "!dm-chen:aether.local", kind: "direct", name: "陈默",
    memberIds: [ME_ID, "@chen:aether.local"], topic: "", unread: 0, pinned: false, muted: true, encrypted: true,
  },
];

export const demoDevices: DeviceItem[] = [
  { id: "AETH-7F2C", name: "此设备 · Chrome / Windows", lastSeen: "刚刚", verified: true, current: true },
  { id: "AETH-19B4", name: "iPhone 15 · 主屏幕 PWA", lastSeen: "2 小时前", verified: true, current: false },
  { id: "AETH-88D1", name: "iPad Air · Safari", lastSeen: "3 天前", verified: false, current: false },
];

const MIN = 60_000;
const HOUR = 60 * MIN;

/** 构造演示消息；全部为本地模拟数据，不含任何真实通信内容。 */
export function buildDemoMessages(now: number): Record<string, Message[]> {
  const team = "!team:aether.local";
  const dmLin = "!dm-lin:aether.local";
  const dmZhou = "!dm-zhou:aether.local";
  const dmChen = "!dm-chen:aether.local";

  const m = (
    id: string, roomId: string, senderId: string, body: string, minutesAgo: number,
    extra: Partial<Message> = {},
  ): Message => ({
    id, roomId, senderId, kind: "text", body,
    ts: now - minutesAgo * MIN, status: "read", ...extra,
  });

  return {
    [team]: [
      m("t1", team, "@lin:aether.local", "早上好，房间的加密状态我昨晚复查过了，服务器侧只有密文。", 180),
      m("t2", team, "@zhou:aether.local", "收到。邀请码那边我按新规则重新发了一批，人数上限已经取消了。", 172),
      m("t3", team, ME_ID, "明白，以后扩容不用再改配置了，直接发码就行。", 165, { replyTo: "t2" }),
      m("t4", team, "@lin:aether.local", "对。准入完全靠邀请码，所以发码权限要盯紧一点。", 158, {
        reactions: [{ emoji: "✓", count: 3, mine: true }],
      }),
      m("t5", team, "@chen:aether.local", "这是上周的联调记录，先放这儿。", 96, {
        kind: "file", body: "", attachment: { name: "联调记录-2026W45.pdf", size: "1.8 MB", mime: "application/pdf" },
      }),
      m("t6", team, "@zhou:aether.local", "界面深色模式我看了，浅色切换也顺手。", 42),
      m("t7", team, "@lin:aether.local", "这条我撤回了，发错窗口。", 35, { revoked: true }),
      m("t8", team, "@zhou:aether.local", "语音我晚点补一段说明。", 12, { kind: "voice", body: "", durationSec: 23 }),
      m("t9", team, "@lin:aether.local", "新的前端 demo 好了吗？想点开试试交互。", 4),
    ],
    [dmLin]: [
      m("l1", dmLin, "@lin:aether.local", "密钥备份记得做，清浏览器数据之前一定要先导出恢复密钥。", 300),
      m("l2", dmLin, ME_ID, "记着呢，恢复密钥离线存了两份。", 292),
      m("l3", dmLin, "@lin:aether.local", "好。设备管理页能看待验证设备，那个 iPad 有空处理下。", 285),
      m("l4", dmLin, ME_ID, "今晚验证一下。", 120, { status: "read" }),
      m("l5", dmLin, "@lin:aether.local", "照片发你了，看看构图。", 60, {
        kind: "image", body: "", attachment: { name: "harbor-dusk.jpg", size: "842 KB", mime: "image/jpeg" },
      }),
      m("l6", dmLin, ME_ID, "光线不错，暗部再提一点就更稳了。", 55, { replyTo: "l5" }),
      m("l7", dmLin, "@lin:aether.local", "demo 里可以试试回复和撤回，交互都做好了。", 2),
    ],
    [dmZhou]: [
      m("z1", dmZhou, "@zhou:aether.local", "搜索我试了下，能按会话和消息内容过滤。", 240),
      m("z2", dmZhou, ME_ID, "挺好，撤回之后也会标成「已撤回」。", 235),
      m("z3", dmZhou, "@zhou:aether.local", "发送状态那段做了分阶段模拟，发出去会依次变。", 230, {
        reactions: [{ emoji: "✓", count: 2, mine: false }],
      }),
      m("z4", dmZhou, ME_ID, "看到了，已读也会跟着变。", 228),
      m("z5", dmZhou, "@zhou:aether.local", "有想法随时说。", 200),
    ],
    [dmChen]: [
      m("c1", dmChen, "@chen:aether.local", "我这边先静音了，晚点回。", 1500),
      m("c2", dmChen, ME_ID, "好，不急。", 1490),
      m("c3", dmChen, "@chen:aether.local", "会议纪要我晚点整理。", 1440),
    ],
  };
}

/** 演示模式下用于模拟对方回复的语料（与真实通信无关）。 */
export const demoReplies: string[] = [
  "收到，我看看。",
  "嗯，这个交互挺顺的。",
  "明白，那就按这个来。",
  "好，我这边也试一下。",
  "等下我把结果发你。",
  "这个状态变化做得很清楚。",
];

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatDayLabel(ts: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  const diff = Math.round((today - day) / (24 * HOUR));
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  const d = new Date(ts);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function formatListTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 24 * HOUR && startOfDay(ts) === startOfDay(Date.now())) return formatClock(ts);
  if (diff < 48 * HOUR) return "昨天";
  return `${new Date(ts).getMonth() + 1}/${new Date(ts).getDate()}`;
}
