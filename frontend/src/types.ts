export type MessageKind = "text" | "image" | "file" | "voice";
export type DeliveryStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export interface Contact {
  id: string;
  name: string;
  initials: string;
  color: string;
  online: boolean;
  verified: boolean;
  role?: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface Attachment {
  name: string;
  size: string;
  mime: string;
}

export interface Message {
  id: string;
  roomId: string;
  senderId: string;
  kind: MessageKind;
  body: string;
  ts: number;
  status: DeliveryStatus;
  replyTo?: string;
  revoked?: boolean;
  reactions?: Reaction[];
  attachment?: Attachment;
  durationSec?: number;
}

export interface Conversation {
  id: string;
  kind: "direct" | "group";
  name: string;
  memberIds: string[];
  topic: string;
  unread: number;
  pinned: boolean;
  muted: boolean;
  /** 演示字段：表示「未来接入 Matrix 后该房间启用 Megolm」，当前并未真正加密。 */
  encrypted: boolean;
}

export interface DeviceItem {
  id: string;
  name: string;
  lastSeen: string;
  verified: boolean;
  current: boolean;
}

export interface DemoSettings {
  notifications: boolean;
  readReceipts: boolean;
  autoDownload: boolean;
  enterToSend: boolean;
}
