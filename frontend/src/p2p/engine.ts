import { decryptAttachment, decryptMessage, encryptAttachment, encryptMessage, newHeader, signData, verifyData, type PlainMessage, type PublicIdentity, type SignedEnvelope, type VaultSession } from "./crypto";
import { decodeSignal } from "./signal";
import { ManualPeerLink, type PeerConnectionStatus } from "./transport";
import { ackReplica, createRoom, getAttachment, getEnvelope, getPeer, getRoom, listOutbox, listRoomEnvelopes, listRooms, saveAttachment, savePeer, saveRoom, saveVault, storeIncoming, storeOutgoing, verifyPeer, type RoomRecord, type StoredEnvelope } from "./storage";

type Frame =
  | { type: "invite"; room: RoomRecord; key: ReturnType<VaultSession["sealRoomKey"]> }
  | { type: "roster"; room: RoomRecord; signature: string }
  | { type: "key-update"; room: RoomRecord; signature: string; key: ReturnType<VaultSession["sealRoomKey"]> }
  | { type: "removed"; roomId: string; deviceId: string; epoch: number; signature: string }
  | { type: "envelope"; envelope: SignedEnvelope; ttl: number }
  | { type: "ack"; messageId: string; deviceId: string; signature: string; ttl: number }
  | { type: "index"; roomId: string; ids: string[] }
  | { type: "request"; roomId: string; ids: string[] }
  | { type: "attachment-ready"; messageId: string }
  | { type: "attachment-request"; messageId: string }
  | { type: "attachment-meta"; messageId: string; attachmentId: string; sha256: string; total: number; chunks: number }
  | { type: "attachment-chunk"; attachmentId: string; index: number; data: string };

export interface VisibleMessage {
  id: string;
  sender: string;
  senderId: string;
  body: string;
  createdAt: number;
  replicas: number;
  kind: PlainMessage["kind"];
  attachmentId?: string;
  attachmentName?: string;
  attachmentMime?: string;
  attachmentBytes?: number;
  attachmentReady?: boolean;
  replyTo?: string;
  deleted?: boolean;
  reactions?: Record<string, number>;
  targetMessageId?: string;
  emoji?: string;
}

interface IncomingAttachment { messageId: string; roomId: string; sha256: string; total: number; chunks: number; parts: Map<number, Uint8Array> }

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function unbase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class P2PEngine {
  readonly links = new Map<string, ManualPeerLink>();
  readonly pending = new Set<ManualPeerLink>();
  onChange: () => void = () => {};
  onError: (message: string) => void = () => {};
  private lamport = 0;
  private sequence = 0;
  private incomingAttachments = new Map<string, IncomingAttachment>();

  constructor(readonly session: VaultSession, readonly stunUrls: string[]) {}

  private makeLink(): ManualPeerLink {
    const link: ManualPeerLink = new ManualPeerLink(this.session, this.stunUrls, {
      onStatus: (status) => void this.statusChanged(link, status),
      onFrame: (raw, from) => this.receive(raw, from, link),
      onError: (message) => this.onError(message),
    });
    this.pending.add(link);
    return link;
  }

  private async statusChanged(link: ManualPeerLink, status: PeerConnectionStatus): Promise<void> {
    if (status === "connected" && link.remoteIdentity) {
      const id = link.remoteIdentity.deviceId;
      await savePeer(link.remoteIdentity);
      const previous = this.links.get(id);
      if (previous && previous !== link) previous.close();
      this.links.set(id, link);
      this.pending.delete(link);
      await this.syncWith(link);
    }
    this.onChange();
  }

  async offer(roomId?: string): Promise<string> {
    const link = this.makeLink();
    try { return (await link.createOffer(roomId)).code; }
    catch (error) { link.close(); this.pending.delete(link); throw error; }
  }

  async answer(code: string): Promise<string> {
    const signal = await decodeSignal(code);
    if (signal.kind !== "offer") throw new Error("请输入发起码");
    const existing = this.links.get(signal.from.deviceId);
    const link = existing ?? this.makeLink();
    try { return (await link.acceptOffer(code)).code; }
    catch (error) { if (!existing) { link.close(); this.pending.delete(link); } throw error; }
  }

  async finish(code: string): Promise<PublicIdentity> {
    const signal = await decodeSignal(code);
    if (signal.kind !== "answer") throw new Error("请输入应答码");
    const link = [...this.pending, ...this.links.values()].find((item) => item.expectsAnswer && (!item.remoteIdentity || item.remoteIdentity.deviceId === signal.from.deviceId));
    if (!link) throw new Error("没有等待应答的连接，请先创建发起码");
    return link.acceptAnswer(code);
  }

  async restartOffer(deviceId: string): Promise<string> {
    const link = this.links.get(deviceId);
    if (!link) throw new Error("没有可重连的设备，请重新配对");
    return (await link.createOffer(undefined, true)).code;
  }

  async createRoom(name: string): Promise<RoomRecord> {
    const roomId = crypto.randomUUID();
    this.session.createRoom(roomId);
    const now = Date.now();
    const room: RoomRecord = { roomId, name: name.trim().slice(0, 80), ownerDeviceId: this.session.publicIdentity.deviceId,
      members: [this.session.publicIdentity], currentEpoch: 1, createdAt: now, updatedAt: now, lastReadLamport: 0 };
    await createRoom(room, this.session.publicIdentity.deviceId);
    await saveVault(this.session.encryptedRecord());
    this.onChange();
    return room;
  }

  async trustPeer(deviceId: string): Promise<void> {
    const link = this.links.get(deviceId);
    if (!link?.remoteIdentity || !link.ready) throw new Error("设备尚未建立连接");
    await verifyPeer(deviceId);
    await this.syncWith(link);
    this.onChange();
  }

  async invite(roomId: string, deviceId: string): Promise<void> {
    const room = await getRoom(roomId);
    const link = this.links.get(deviceId);
    const peer = await getPeer(deviceId);
    if (!room || room.ownerDeviceId !== this.session.publicIdentity.deviceId) throw new Error("只有房间创建者可以邀请成员");
    if (!link?.ready || !peer?.verifiedAt) throw new Error("请先建立连接并当面核对设备指纹");
    if (room.members.length >= 4 && !room.members.some((member) => member.deviceId === deviceId)) throw new Error("房间最多四人");
    const members = room.members.some((member) => member.deviceId === deviceId) ? room.members : [...room.members, peer.identity];
    const next = { ...room, members, updatedAt: Date.now() };
    await saveRoom(next, this.session.publicIdentity.deviceId);
    await link.send({ type: "invite", room: next, key: this.session.sealRoomKey(roomId, peer.identity) } satisfies Frame);
    await this.broadcast(next, this.rosterFrame(next), deviceId);
    await this.syncWith(link);
    this.onChange();
  }

  async removeMember(roomId: string, deviceId: string): Promise<void> {
    const room = await getRoom(roomId);
    if (!room || room.ownerDeviceId !== this.session.publicIdentity.deviceId) throw new Error("只有房间创建者可以移除成员");
    if (deviceId === room.ownerDeviceId || !room.members.some((member) => member.deviceId === deviceId)) throw new Error("无法移除该设备");
    const epoch = this.session.rotateRoomKey(roomId);
    const next = { ...room, members: room.members.filter((member) => member.deviceId !== deviceId), currentEpoch: epoch, updatedAt: Date.now() };
    await saveRoom(next, this.session.publicIdentity.deviceId);
    await saveVault(this.session.encryptedRecord());
    const removedLink = this.links.get(deviceId);
    if (removedLink?.ready) {
      const statement = { roomId, deviceId, epoch };
      await removedLink.send({ type: "removed", ...statement, signature: signData(this.session, "removed", statement) } satisfies Frame);
    }
    for (const member of next.members) {
      if (member.deviceId === this.session.publicIdentity.deviceId) continue;
      const link = this.links.get(member.deviceId);
      if (link?.ready && (await getPeer(member.deviceId))?.verifiedAt) await link.send(this.keyUpdateFrame(next, member));
    }
    this.onChange();
  }

  private rosterFrame(room: RoomRecord): Extract<Frame, { type: "roster" }> {
    return { type: "roster", room, signature: signData(this.session, "roster", room) };
  }

  private keyUpdateFrame(room: RoomRecord, recipient: PublicIdentity): Extract<Frame, { type: "key-update" }> {
    return { type: "key-update", room, signature: signData(this.session, "roster", room),
      key: this.session.sealRoomKey(room.roomId, recipient, room.currentEpoch) };
  }

  private ackFrame(messageId: string): Extract<Frame, { type: "ack" }> {
    const deviceId = this.session.publicIdentity.deviceId;
    return { type: "ack", messageId, deviceId, signature: signData(this.session, "ack", { messageId, deviceId }), ttl: 3 };
  }

  async sendText(roomId: string, body: string, replyTo?: string): Promise<void> {
    if (!body.trim()) throw new Error("消息不能为空");
    await this.sendPlain(roomId, { kind: "text", body: body.trim(), ...(replyTo ? { replyTo } : {}) });
  }

  async revoke(roomId: string, targetMessageId: string): Promise<void> {
    const target = await getEnvelope(targetMessageId);
    if (!target || target.roomId !== roomId || target.senderDeviceId !== this.session.publicIdentity.deviceId) throw new Error("只能撤回自己发送的消息");
    await this.sendPlain(roomId, { kind: "delete", targetMessageId });
  }

  async react(roomId: string, targetMessageId: string, emoji: string): Promise<void> {
    if (!/^[\p{Extended_Pictographic}\uFE0F]{1,8}$/u.test(emoji)) throw new Error("表情无效");
    const target = await getEnvelope(targetMessageId);
    if (!target || target.roomId !== roomId) throw new Error("目标消息不存在");
    await this.sendPlain(roomId, { kind: "reaction", targetMessageId, emoji });
  }

  private async sendPlain(roomId: string, plain: PlainMessage): Promise<void> {
    const room = await getRoom(roomId);
    if (!room || room.removedAt) throw new Error("房间已移除或消息无效");
    const existing = await listRoomEnvelopes(roomId);
    this.lamport = Math.max(this.lamport, ...existing.map((entry) => entry.lamportTimestamp), 0) + 1;
    this.sequence = Math.max(this.sequence, ...existing.filter((entry) => entry.senderDeviceId === this.session.publicIdentity.deviceId).map((entry) => entry.senderSequence), 0) + 1;
    const envelope = encryptMessage(this.session, newHeader({ roomId, senderDeviceId: this.session.publicIdentity.deviceId,
      senderSequence: this.sequence, lamportTimestamp: this.lamport, epoch: this.session.currentEpoch(roomId) }),
      plain);
    await storeOutgoing(envelope, room.members.filter((member) => member.deviceId !== this.session.publicIdentity.deviceId).map((member) => member.deviceId));
    this.onChange();
    await this.broadcast(room, { type: "envelope", envelope, ttl: 3 });
  }

  async sendAttachment(roomId: string, file: File): Promise<void> {
    const room = await getRoom(roomId);
    if (!room || room.removedAt) throw new Error("房间不存在或已移除");
    if (file.size < 1 || file.size > 2 * 1024 * 1024) throw new Error("附件须在 1 字节至 2 MiB 之间");
    const attachmentId = crypto.randomUUID();
    const epoch = this.session.currentEpoch(roomId);
    const { encrypted, sha256 } = await encryptAttachment(this.session, roomId, epoch, attachmentId, new Uint8Array(await file.arrayBuffer()));
    const records = await listRoomEnvelopes(roomId);
    this.lamport = Math.max(this.lamport, ...records.map((entry) => entry.lamportTimestamp), 0) + 1;
    this.sequence = Math.max(this.sequence, ...records.filter((entry) => entry.senderDeviceId === this.session.publicIdentity.deviceId).map((entry) => entry.senderSequence), 0) + 1;
    const envelope = encryptMessage(this.session, newHeader({ roomId, senderDeviceId: this.session.publicIdentity.deviceId,
      senderSequence: this.sequence, lamportTimestamp: this.lamport, epoch }), {
      kind: file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "voice" : "file",
      attachmentId, attachmentName: file.name.slice(0, 160), attachmentMime: file.type || "application/octet-stream",
      attachmentBytes: file.size, attachmentSha256: sha256,
    });
    await saveAttachment({ attachmentId, roomId, messageId: envelope.header.messageId,
      encryptedBytes: encrypted.buffer as ArrayBuffer, sha256, totalBytes: encrypted.length, storedAt: Date.now() });
    await storeOutgoing(envelope, room.members.filter((member) => member.deviceId !== this.session.publicIdentity.deviceId).map((member) => member.deviceId));
    this.onChange();
    await this.broadcast(room, { type: "envelope", envelope, ttl: 3 });
    await this.broadcast(room, { type: "attachment-ready", messageId: envelope.header.messageId });
  }

  async attachmentBlob(messageId: string): Promise<{ blob: Blob; name: string }> {
    const record = await getEnvelope(messageId);
    const room = record && await getRoom(record.roomId);
    const sender = room?.members.find((member) => member.deviceId === record?.senderDeviceId);
    if (!record || !room || !sender) throw new Error("附件消息不存在");
    const plain = decryptMessage(this.session, record.envelope, sender);
    const attachment = plain.attachmentId && await getAttachment(plain.attachmentId);
    if (!attachment || !plain.attachmentSha256) throw new Error("附件尚未同步到本设备");
    const bytes = await decryptAttachment(this.session, room.roomId, record.envelope.header.epoch,
      plain.attachmentId!, new Uint8Array(attachment.encryptedBytes), plain.attachmentSha256);
    return { blob: new Blob([bytes as BlobPart], { type: plain.attachmentMime || "application/octet-stream" }), name: plain.attachmentName || "attachment" };
  }

  async messages(roomId: string): Promise<VisibleMessage[]> {
    const room = await getRoom(roomId);
    if (!room) return [];
    const records = await listRoomEnvelopes(roomId);
    const events = await Promise.all(records.map(async (record) => {
      const sender = room.members.find((member) => member.deviceId === record.senderDeviceId);
      try {
        if (!sender) throw new Error("发送者不在成员列表");
        const plain = decryptMessage(this.session, record.envelope, sender);
        return { id: record.messageId, sender: sender.name, senderId: sender.deviceId, body: plain.body ?? "", createdAt: record.envelope.header.createdAt,
          replicas: 1 + record.ackedBy.length, kind: plain.kind,
          attachmentId: plain.attachmentId, attachmentName: plain.attachmentName, attachmentMime: plain.attachmentMime,
          attachmentBytes: plain.attachmentBytes, attachmentReady: plain.attachmentId ? Boolean(await getAttachment(plain.attachmentId)) : undefined,
          replyTo: plain.replyTo, targetMessageId: plain.targetMessageId, emoji: plain.emoji };
      } catch {
        return { id: record.messageId, sender: sender?.name ?? "未知设备", senderId: sender?.deviceId ?? "", body: "[无法解密或密钥缺失]",
          createdAt: record.envelope.header.createdAt, replicas: 1 + record.ackedBy.length, kind: "text" as const };
      }
    }));
    const rendered = new Map<string, VisibleMessage>();
    for (const event of events) {
      if (event.kind === "delete") {
        const target = event.targetMessageId && rendered.get(event.targetMessageId);
        if (target && target.senderId === event.senderId) { target.deleted = true; target.body = "已撤回"; target.attachmentId = undefined; target.attachmentReady = false; }
      } else if (event.kind === "reaction") {
        const target = event.targetMessageId && rendered.get(event.targetMessageId);
        if (target && !target.deleted && event.emoji) target.reactions = { ...target.reactions, [event.emoji]: (target.reactions?.[event.emoji] ?? 0) + 1 };
      } else rendered.set(event.id, event);
    }
    return [...rendered.values()];
  }

  async rooms(): Promise<RoomRecord[]> { return listRooms(); }

  private async broadcast(room: RoomRecord, frame: Frame, except?: string): Promise<void> {
    await Promise.all(room.members.filter((member) => member.deviceId !== except).map(async (member) => {
      const link = this.links.get(member.deviceId);
      if (link?.ready && (await getPeer(member.deviceId))?.verifiedAt) {
        try { await link.send(frame); } catch (error) { this.onError(error instanceof Error ? error.message : String(error)); }
      }
    }));
  }

  private async syncWith(link: ManualPeerLink): Promise<void> {
    if (!link.remoteIdentity || !(await getPeer(link.remoteIdentity.deviceId))?.verifiedAt) return;
    for (const room of await listRooms()) {
      if (!room.members.some((member) => member.deviceId === link.remoteIdentity?.deviceId)) continue;
      if (room.ownerDeviceId === this.session.publicIdentity.deviceId) await link.send(this.keyUpdateFrame(room, link.remoteIdentity));
      const records = await listRoomEnvelopes(room.roomId);
      for (let index = 0; index < records.length; index += 100) {
        await link.send({ type: "index", roomId: room.roomId, ids: records.slice(index, index + 100).map((item) => item.messageId) } satisfies Frame);
      }
      for (const record of records) {
        const sender = room.members.find((member) => member.deviceId === record.senderDeviceId);
        if (!sender) continue;
        try {
          const plain = decryptMessage(this.session, record.envelope, sender);
          if (plain.attachmentId) {
            await link.send({ type: (await getAttachment(plain.attachmentId)) ? "attachment-ready" : "attachment-request", messageId: record.messageId } satisfies Frame);
          }
        } catch { /* Missing an old epoch key is shown in the message list. */ }
      }
    }
    for (const item of await listOutbox()) {
      if (!item.pendingDeviceIds.includes(link.remoteIdentity.deviceId)) continue;
      const record = await getEnvelope(item.messageId);
      if (record) await link.send({ type: "envelope", envelope: record.envelope, ttl: 3 } satisfies Frame);
    }
  }

  private async receive(raw: unknown, from: PublicIdentity, link: ManualPeerLink): Promise<void> {
    if (!isRecord(raw) || typeof raw.type !== "string") throw new Error("未知 P2P 数据帧");
    const peer = await getPeer(from.deviceId);
    if (!peer?.verifiedAt) throw new Error("未核对指纹的设备不能收发房间数据");
    if (raw.type === "invite") {
      const frame = raw as unknown as Extract<Frame, { type: "invite" }>;
      const room = frame.room;
      if (!room || room.ownerDeviceId !== from.deviceId || !room.members?.some((member) => member.deviceId === this.session.publicIdentity.deviceId) || room.members.length > 4 || frame.key?.roomId !== room.roomId) throw new Error("房间邀请无效");
      this.session.openRoomKey(frame.key, from);
      await saveRoom(room, this.session.publicIdentity.deviceId);
      await saveVault(this.session.encryptedRecord());
      this.onChange();
      await this.syncWith(link);
      return;
    }
    if (raw.type === "roster") {
      const frame = raw as unknown as Extract<Frame, { type: "roster" }>;
      const current = await getRoom(frame.room?.roomId);
      if (!current || current.ownerDeviceId !== from.deviceId || frame.room.ownerDeviceId !== from.deviceId ||
          frame.room.members.length > 4 || frame.room.currentEpoch !== current.currentEpoch ||
          !current.members.every((member) => frame.room.members.some((newMember) => newMember.deviceId === member.deviceId)) ||
          !verifyData(from, "roster", frame.room, frame.signature)) throw new Error("房间成员更新验证失败");
      await saveRoom(frame.room, this.session.publicIdentity.deviceId);
      this.onChange();
      return;
    }
    if (raw.type === "key-update") {
      const frame = raw as unknown as Extract<Frame, { type: "key-update" }>;
      const current = await getRoom(frame.room?.roomId);
      if (!current || current.ownerDeviceId !== from.deviceId || frame.room.ownerDeviceId !== from.deviceId ||
          frame.room.members.length > 4 || !frame.room.members.some((member) => member.deviceId === this.session.publicIdentity.deviceId) ||
          frame.room.currentEpoch < current.currentEpoch || frame.key?.roomId !== frame.room.roomId ||
          frame.key.epoch !== frame.room.currentEpoch || !verifyData(from, "roster", frame.room, frame.signature)) throw new Error("房间密钥更新验证失败");
      this.session.openRoomKey(frame.key, from);
      await saveRoom(frame.room, this.session.publicIdentity.deviceId);
      await saveVault(this.session.encryptedRecord());
      this.onChange();
      return;
    }
    if (raw.type === "removed") {
      const frame = raw as unknown as Extract<Frame, { type: "removed" }>;
      const room = await getRoom(frame.roomId);
      if (!room || room.ownerDeviceId !== from.deviceId || frame.deviceId !== this.session.publicIdentity.deviceId ||
          !Number.isSafeInteger(frame.epoch) || frame.epoch <= room.currentEpoch ||
          !verifyData(from, "removed", { roomId: frame.roomId, deviceId: frame.deviceId, epoch: frame.epoch }, frame.signature)) throw new Error("成员移除通知无效");
      await saveRoom({ ...room, removedAt: Date.now() }, this.session.publicIdentity.deviceId);
      this.onChange();
      return;
    }
    if (raw.type === "envelope") {
      const frame = raw as unknown as Extract<Frame, { type: "envelope" }>;
      const room = await getRoom(frame.envelope?.header?.roomId);
      if (!room || room.removedAt || !room.members.some((member) => member.deviceId === from.deviceId)) throw new Error("发送方不在房间中");
      const added = await storeIncoming(frame.envelope);
      if (frame.envelope.header.senderDeviceId !== this.session.publicIdentity.deviceId) await link.send(this.ackFrame(frame.envelope.header.messageId));
      if (added) {
        this.lamport = Math.max(this.lamport, frame.envelope.header.lamportTimestamp) + 1;
        this.onChange();
        if (Number.isSafeInteger(frame.ttl) && frame.ttl > 0 && frame.ttl <= 3) await this.broadcast(room, { ...frame, ttl: frame.ttl - 1 }, from.deviceId);
        const sender = room.members.find((member) => member.deviceId === frame.envelope.header.senderDeviceId);
        if (sender) {
          try {
            const plain = decryptMessage(this.session, frame.envelope, sender);
            if (plain.attachmentId && !(await getAttachment(plain.attachmentId))) await link.send({ type: "attachment-request", messageId: frame.envelope.header.messageId } satisfies Frame);
          } catch { /* Message remains stored as ciphertext when an epoch key is unavailable. */ }
        }
      }
      return;
    }
    if (raw.type === "ack" && typeof raw.messageId === "string") {
      const frame = raw as unknown as Extract<Frame, { type: "ack" }>;
      const record = await getEnvelope(frame.messageId);
      const room = record && await getRoom(record.roomId);
      const holder = room?.members.find((member) => member.deviceId === frame.deviceId);
      if (!record || !room || !holder || !room.members.some((member) => member.deviceId === from.deviceId) ||
          !verifyData(holder, "ack", { messageId: frame.messageId, deviceId: frame.deviceId }, frame.signature)) throw new Error("副本确认签名无效");
      if (!record.ackedBy.includes(frame.deviceId) && frame.deviceId !== record.senderDeviceId) {
        await ackReplica(frame.messageId, frame.deviceId);
        this.onChange();
        if (Number.isSafeInteger(frame.ttl) && frame.ttl > 0 && frame.ttl <= 3) await this.broadcast(room, { ...frame, ttl: frame.ttl - 1 }, from.deviceId);
      }
      return;
    }
    if ((raw.type === "attachment-ready" || raw.type === "attachment-request") && typeof raw.messageId === "string") {
      const record = await getEnvelope(raw.messageId);
      const room = record && await getRoom(record.roomId);
      const sender = room?.members.find((member) => member.deviceId === record?.senderDeviceId);
      if (!record || !room || !sender || !room.members.some((member) => member.deviceId === from.deviceId)) throw new Error("附件请求房间无效");
      const plain = decryptMessage(this.session, record.envelope, sender);
      if (!plain.attachmentId || !plain.attachmentSha256) throw new Error("消息没有附件");
      if (raw.type === "attachment-ready") {
        if (!(await getAttachment(plain.attachmentId))) await link.send({ type: "attachment-request", messageId: record.messageId } satisfies Frame);
      } else {
        const attachment = await getAttachment(plain.attachmentId);
        if (!attachment || attachment.sha256 !== plain.attachmentSha256) return;
        const bytes = new Uint8Array(attachment.encryptedBytes);
        const chunkSize = 12 * 1024;
        const chunks = Math.ceil(bytes.length / chunkSize);
        await link.send({ type: "attachment-meta", messageId: record.messageId, attachmentId: plain.attachmentId,
          sha256: attachment.sha256, total: bytes.length, chunks } satisfies Frame);
        for (let index = 0; index < chunks; index++) {
          await link.send({ type: "attachment-chunk", attachmentId: plain.attachmentId, index,
            data: base64(bytes.subarray(index * chunkSize, (index + 1) * chunkSize)) } satisfies Frame);
        }
      }
      return;
    }
    if (raw.type === "attachment-meta") {
      const frame = raw as unknown as Extract<Frame, { type: "attachment-meta" }>;
      const record = await getEnvelope(frame.messageId);
      const room = record && await getRoom(record.roomId);
      const sender = room?.members.find((member) => member.deviceId === record?.senderDeviceId);
      if (!record || !room || !sender || !room.members.some((member) => member.deviceId === from.deviceId)) throw new Error("附件元数据房间无效");
      const plain = decryptMessage(this.session, record.envelope, sender);
      if (!plain.attachmentId || frame.attachmentId !== plain.attachmentId || frame.sha256 !== plain.attachmentSha256 ||
          !Number.isSafeInteger(frame.total) || frame.total < 40 || frame.total > 2 * 1024 * 1024 + 40 ||
          frame.chunks !== Math.ceil(frame.total / (12 * 1024))) throw new Error("附件元数据与签名消息不符");
      if (!(await getAttachment(frame.attachmentId))) this.incomingAttachments.set(frame.attachmentId, {
        messageId: record.messageId, roomId: room.roomId, sha256: frame.sha256, total: frame.total, chunks: frame.chunks, parts: new Map(),
      });
      return;
    }
    if (raw.type === "attachment-chunk") {
      const frame = raw as unknown as Extract<Frame, { type: "attachment-chunk" }>;
      const transfer = this.incomingAttachments.get(frame.attachmentId);
      if (!transfer) return;
      const room = await getRoom(transfer.roomId);
      if (!room?.members.some((member) => member.deviceId === from.deviceId) || !Number.isSafeInteger(frame.index) ||
          frame.index < 0 || frame.index >= transfer.chunks || typeof frame.data !== "string" || frame.data.length > 17000) throw new Error("附件分片无效");
      const bytes = unbase64(frame.data);
      if (bytes.length === 0 || bytes.length > 12 * 1024) throw new Error("附件分片大小无效");
      const previous = transfer.parts.get(frame.index);
      if (previous && base64(previous) !== frame.data) throw new Error("重复附件分片内容冲突");
      transfer.parts.set(frame.index, bytes);
      if (transfer.parts.size === transfer.chunks) {
        this.incomingAttachments.delete(frame.attachmentId);
        const encrypted = new Uint8Array(transfer.total);
        let offset = 0;
        for (let index = 0; index < transfer.chunks; index++) { const part = transfer.parts.get(index)!; encrypted.set(part, offset); offset += part.length; }
        if (offset !== transfer.total) throw new Error("附件分片长度不匹配");
        const record = await getEnvelope(transfer.messageId);
        if (!record) throw new Error("附件消息丢失");
        await decryptAttachment(this.session, transfer.roomId, record.envelope.header.epoch, frame.attachmentId, encrypted, transfer.sha256);
        await saveAttachment({ attachmentId: frame.attachmentId, roomId: transfer.roomId, messageId: transfer.messageId,
          encryptedBytes: encrypted.buffer as ArrayBuffer, sha256: transfer.sha256, totalBytes: transfer.total, storedAt: Date.now() });
        this.onChange();
        await this.broadcast(room, { type: "attachment-ready", messageId: transfer.messageId }, from.deviceId);
      }
      return;
    }
    if ((raw.type === "index" || raw.type === "request") && typeof raw.roomId === "string" && Array.isArray(raw.ids) && raw.ids.length <= 100 && raw.ids.every((id) => typeof id === "string" && id.length <= 100)) {
      const room = await getRoom(raw.roomId);
      if (!room?.members.some((member) => member.deviceId === from.deviceId)) throw new Error("同步请求者不在房间中");
      if (raw.type === "index") {
        const missing: string[] = [];
        for (const id of raw.ids) if (!(await getEnvelope(id))) missing.push(id);
        if (missing.length) await link.send({ type: "request", roomId: room.roomId, ids: missing } satisfies Frame);
      } else {
        for (const id of raw.ids) {
          const record: StoredEnvelope | undefined = await getEnvelope(id);
          if (record?.roomId === room.roomId) await link.send({ type: "envelope", envelope: record.envelope, ttl: 0 } satisfies Frame);
        }
      }
      return;
    }
    throw new Error("无效的 P2P 数据帧");
  }

  close(): void {
    for (const link of this.links.values()) link.close();
    for (const link of this.pending) link.close();
    this.links.clear(); this.pending.clear(); this.session.lock();
  }
}
