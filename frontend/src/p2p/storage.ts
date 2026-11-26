import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { verifyEnvelope, verifyPublicIdentity, type PublicIdentity, type SignedEnvelope, type VaultRecord } from "./crypto";

const DATABASE_NAME = "aether-p2p-v1";
const DATABASE_VERSION = 1;

export interface RoomRecord {
  roomId: string;
  name: string;
  ownerDeviceId: string;
  members: PublicIdentity[];
  currentEpoch: number;
  createdAt: number;
  updatedAt: number;
  lastReadLamport: number;
  removedAt?: number;
}

export interface PeerRecord {
  deviceId: string;
  identity: PublicIdentity;
  verifiedAt: number | null;
  lastSeenAt: number | null;
}

export interface StoredEnvelope {
  messageId: string;
  roomId: string;
  senderDeviceId: string;
  senderSequence: number;
  lamportTimestamp: number;
  envelope: SignedEnvelope;
  storedAt: number;
  ackedBy: string[];
}

export interface OutboxItem {
  messageId: string;
  roomId: string;
  pendingDeviceIds: string[];
  attempts: number;
  nextAttemptAt: number;
}

export interface AttachmentRecord {
  attachmentId: string;
  roomId: string;
  messageId: string;
  encryptedBytes: ArrayBuffer;
  sha256: string;
  totalBytes: number;
  storedAt: number;
}

interface AetherDatabase extends DBSchema {
  vault: { key: string; value: VaultRecord };
  rooms: { key: string; value: RoomRecord; indexes: { "by-updated": number } };
  peers: { key: string; value: PeerRecord };
  envelopes: {
    key: string;
    value: StoredEnvelope;
    indexes: {
      "by-room-lamport": [string, number];
      "by-sender-sequence": [string, number];
    };
  };
  outbox: { key: string; value: OutboxItem; indexes: { "by-next-attempt": number } };
  attachments: { key: string; value: AttachmentRecord };
  settings: { key: string; value: { key: string; value: unknown } };
}

let databasePromise: Promise<IDBPDatabase<AetherDatabase>> | null = null;

export function database(): Promise<IDBPDatabase<AetherDatabase>> {
  if (!databasePromise) {
    databasePromise = openDB<AetherDatabase>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(db) {
        db.createObjectStore("vault");
        db.createObjectStore("rooms", { keyPath: "roomId" }).createIndex("by-updated", "updatedAt");
        db.createObjectStore("peers", { keyPath: "deviceId" });
        const envelopes = db.createObjectStore("envelopes", { keyPath: "messageId" });
        envelopes.createIndex("by-room-lamport", ["roomId", "lamportTimestamp"]);
        envelopes.createIndex("by-sender-sequence", ["senderDeviceId", "senderSequence"], { unique: true });
        db.createObjectStore("outbox", { keyPath: "messageId" }).createIndex("by-next-attempt", "nextAttemptAt");
        db.createObjectStore("attachments", { keyPath: "attachmentId" });
        db.createObjectStore("settings", { keyPath: "key" });
      },
      blocked() {
        throw new Error("另一个 Aether 标签页仍在使用旧数据库，请关闭后重试");
      },
    }).catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

export async function loadVault(): Promise<VaultRecord | undefined> {
  return (await database()).get("vault", "primary");
}

export async function saveVault(record: VaultRecord): Promise<void> {
  if (record.format !== 1 || !verifyPublicIdentity(record.publicIdentity)) throw new Error("设备保险箱无效");
  await (await database()).put("vault", record, "primary");
}

export async function savePeer(identity: PublicIdentity): Promise<PeerRecord> {
  if (!verifyPublicIdentity(identity)) throw new Error("设备身份签名无效");
  const db = await database();
  const existing = await db.get("peers", identity.deviceId);
  if (existing && (existing.identity.signingPublicKey !== identity.signingPublicKey || existing.identity.exchangePublicKey !== identity.exchangePublicKey)) {
    throw new Error("设备身份密钥发生变化；请人工核对并重新配对");
  }
  const next = existing ?? { deviceId: identity.deviceId, identity, verifiedAt: null, lastSeenAt: null };
  await db.put("peers", next);
  return next;
}

export async function verifyPeer(deviceId: string): Promise<void> {
  const db = await database();
  const peer = await db.get("peers", deviceId);
  if (!peer) throw new Error("未知设备");
  await db.put("peers", { ...peer, verifiedAt: Date.now() });
}

export async function getPeer(deviceId: string): Promise<PeerRecord | undefined> {
  return (await database()).get("peers", deviceId);
}

export async function listPeers(): Promise<PeerRecord[]> {
  return (await database()).getAll("peers");
}

export async function createRoom(record: RoomRecord, myDeviceId: string): Promise<void> {
  if (!record.roomId || !record.name.trim() || record.members.length < 1 || record.members.length > 4) throw new Error("房间人数必须在 1 至 4 人之间");
  if (!record.members.some((member) => member.deviceId === myDeviceId) || !record.members.some((member) => member.deviceId === record.ownerDeviceId)) {
    throw new Error("房间成员信息不完整");
  }
  const memberIds = record.members.map((member) => member.deviceId);
  if (new Set(memberIds).size !== memberIds.length || !record.members.every(verifyPublicIdentity)) throw new Error("房间成员身份无效或重复");
  await (await database()).add("rooms", record);
}

export async function getRoom(roomId: string): Promise<RoomRecord | undefined> {
  return (await database()).get("rooms", roomId);
}

export async function saveRoom(record: RoomRecord, myDeviceId: string): Promise<void> {
  if (!record.roomId || !record.name.trim() || record.members.length < 1 || record.members.length > 4 ||
      !record.members.some((member) => member.deviceId === myDeviceId) ||
      new Set(record.members.map((member) => member.deviceId)).size !== record.members.length ||
      !record.members.every(verifyPublicIdentity)) throw new Error("房间成员信息无效");
  const db = await database();
  const previous = await db.get("rooms", record.roomId);
  if (previous && previous.ownerDeviceId !== record.ownerDeviceId) throw new Error("房间创建者发生变化");
  await db.put("rooms", record);
}

export async function listRooms(): Promise<RoomRecord[]> {
  const rooms = await (await database()).getAllFromIndex("rooms", "by-updated");
  return rooms.reverse();
}

export async function setRoomRead(roomId: string, lamport: number): Promise<void> {
  const db = await database();
  const room = await db.get("rooms", roomId);
  if (!room) throw new Error("未知房间");
  room.lastReadLamport = Math.max(room.lastReadLamport, lamport);
  await db.put("rooms", room);
}

function validateEnvelopeForRoom(envelope: SignedEnvelope, room: RoomRecord): void {
  if (envelope.header.roomId !== room.roomId) throw new Error("消息房间不匹配");
  const sender = room.members.find((member) => member.deviceId === envelope.header.senderDeviceId);
  if (!sender || !verifyEnvelope(envelope, sender)) throw new Error("消息发送者或签名无效");
}

export async function storeIncoming(envelope: SignedEnvelope): Promise<boolean> {
  const db = await database();
  const room = await db.get("rooms", envelope.header.roomId);
  if (!room) throw new Error("未知房间");
  validateEnvelopeForRoom(envelope, room);
  const tx = db.transaction(["envelopes", "rooms"], "readwrite");
  const messages = tx.objectStore("envelopes");
  const existing = await messages.get(envelope.header.messageId);
  if (existing) {
    await tx.done;
    return false;
  }
  const sameSequence = await messages.index("by-sender-sequence").get([envelope.header.senderDeviceId, envelope.header.senderSequence]);
  if (sameSequence) {
    await tx.done;
    throw new Error("同一设备序号出现不同消息，已拒绝写入");
  }
  await messages.add({
    messageId: envelope.header.messageId,
    roomId: envelope.header.roomId,
    senderDeviceId: envelope.header.senderDeviceId,
    senderSequence: envelope.header.senderSequence,
    lamportTimestamp: envelope.header.lamportTimestamp,
    envelope,
    storedAt: Date.now(),
    ackedBy: [],
  });
  room.updatedAt = Date.now();
  await tx.objectStore("rooms").put(room);
  await tx.done;
  return true;
}

export async function storeOutgoing(envelope: SignedEnvelope, recipientDeviceIds: string[]): Promise<void> {
  const db = await database();
  const room = await db.get("rooms", envelope.header.roomId);
  if (!room) throw new Error("未知房间");
  validateEnvelopeForRoom(envelope, room);
  const allowed = new Set(room.members.map((member) => member.deviceId));
  if (recipientDeviceIds.some((id) => !allowed.has(id) || id === envelope.header.senderDeviceId)) throw new Error("收件设备不在房间中");
  const tx = db.transaction(["envelopes", "outbox", "rooms"], "readwrite");
  await tx.objectStore("envelopes").add({
    messageId: envelope.header.messageId,
    roomId: envelope.header.roomId,
    senderDeviceId: envelope.header.senderDeviceId,
    senderSequence: envelope.header.senderSequence,
    lamportTimestamp: envelope.header.lamportTimestamp,
    envelope,
    storedAt: Date.now(),
    ackedBy: [],
  });
  await tx.objectStore("outbox").add({
    messageId: envelope.header.messageId, roomId: envelope.header.roomId,
    pendingDeviceIds: [...new Set(recipientDeviceIds)], attempts: 0, nextAttemptAt: Date.now(),
  });
  room.updatedAt = Date.now();
  await tx.objectStore("rooms").put(room);
  await tx.done;
}

export async function ackReplica(messageId: string, deviceId: string): Promise<number> {
  const db = await database();
  const tx = db.transaction(["envelopes", "outbox", "rooms"], "readwrite");
  const messages = tx.objectStore("envelopes");
  const item = await messages.get(messageId);
  if (!item) throw new Error("未知消息");
  const room = await tx.objectStore("rooms").get(item.roomId);
  if (!room?.members.some((member) => member.deviceId === deviceId) || item.senderDeviceId === deviceId) throw new Error("确认者不在房间中或是原始发送者");
  if (!item.ackedBy.includes(deviceId)) item.ackedBy.push(deviceId);
  await messages.put(item);
  const outbox = tx.objectStore("outbox");
  const queued = await outbox.get(messageId);
  if (queued) {
    queued.pendingDeviceIds = queued.pendingDeviceIds.filter((id) => id !== deviceId);
    if (queued.pendingDeviceIds.length) await outbox.put(queued);
    else await outbox.delete(messageId);
  }
  await tx.done;
  return 1 + item.ackedBy.length;
}

export async function listRoomEnvelopes(roomId: string): Promise<StoredEnvelope[]> {
  const db = await database();
  const records = await db.getAllFromIndex("envelopes", "by-room-lamport", IDBKeyRange.bound([roomId, 0], [roomId, Number.MAX_SAFE_INTEGER]));
  return records.sort((a, b) => a.lamportTimestamp - b.lamportTimestamp || a.senderDeviceId.localeCompare(b.senderDeviceId) || a.senderSequence - b.senderSequence || a.messageId.localeCompare(b.messageId));
}

export async function getEnvelope(messageId: string): Promise<StoredEnvelope | undefined> {
  return (await database()).get("envelopes", messageId);
}

export async function listOutbox(): Promise<OutboxItem[]> {
  return (await database()).getAll("outbox");
}

export async function setOutboxRetry(messageId: string, attempts: number, nextAttemptAt: number): Promise<void> {
  const db = await database();
  const item = await db.get("outbox", messageId);
  if (!item) return;
  await db.put("outbox", { ...item, attempts, nextAttemptAt });
}

export async function saveAttachment(record: AttachmentRecord): Promise<void> {
  if (record.encryptedBytes.byteLength > 20 * 1024 * 1024) throw new Error("附件超过 20 MiB 上限");
  await (await database()).put("attachments", record);
}

export async function getAttachment(attachmentId: string): Promise<AttachmentRecord | undefined> {
  return (await database()).get("attachments", attachmentId);
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await (await database()).put("settings", { key, value });
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const record = await (await database()).get("settings", key);
  return record?.value as T | undefined;
}
