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
  /** Present only for Matrix v2 encrypted media. Never persist outside the decrypted event. */
  encryptedFile?: import("./services/attachment-crypto").MatrixEncryptedFile;
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
  /** 真实链路：原始事件为 m.room.encrypted（Megolm 密文）。演示数据不带此字段。 */
  encrypted?: boolean;
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
  /** 房间是否启用 Megolm。演示数据为占位值；真实链路由 m.room.encryption 状态事件判定。 */
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
