import sodium from "libsodium-wrappers-sumo";

const encoder = new TextEncoder();
const PROTOCOL = "aether-p2p-v1";
const VAULT_AAD = encoder.encode(`${PROTOCOL}:vault`);
const SIGNING_DOMAIN = `${PROTOCOL}:envelope:`;
const EXCHANGE_DOMAIN = `${PROTOCOL}:exchange:`;

export interface PublicIdentity {
  deviceId: string;
  name: string;
  signingPublicKey: string;
  exchangePublicKey: string;
  exchangeProof: string;
}

export interface RoomSecret {
  currentEpoch: number;
  keys: Record<string, string>;
}

interface VaultSecrets {
  signingSecretKey: string;
  exchangeSecretKey: string;
  rooms: Record<string, RoomSecret>;
}

export interface VaultRecord {
  format: 1;
  publicIdentity: PublicIdentity;
  kdf: { algorithm: "argon2id13"; salt: string; opsLimit: number; memLimit: number };
  nonce: string;
  ciphertext: string;
}

export interface EnvelopeHeader {
  protocol: typeof PROTOCOL;
  messageId: string;
  roomId: string;
  senderDeviceId: string;
  senderSequence: number;
  lamportTimestamp: number;
  createdAt: number;
  epoch: number;
}

export interface SignedEnvelope {
  header: EnvelopeHeader;
  nonce: string;
  ciphertext: string;
  signature: string;
}

export interface PlainMessage {
  kind: "text" | "image" | "file" | "voice" | "edit" | "delete" | "reaction";
  body?: string;
  replyTo?: string;
  attachmentId?: string;
  attachmentName?: string;
  attachmentMime?: string;
  attachmentBytes?: number;
  attachmentSha256?: string;
  targetMessageId?: string;
  emoji?: string;
}

function b64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function bytes(value: string): Uint8Array {
  return sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function signData(session: VaultSession, domain: string, payload: unknown): string {
  if (!/^[a-z0-9-]{1,40}$/.test(domain)) throw new Error("签名用途无效");
  return session.sign(encoder.encode(`${PROTOCOL}:${domain}:${canonical(payload)}`));
}

export function verifyData(identity: PublicIdentity, domain: string, payload: unknown, signature: string): boolean {
  try {
    if (!/^[a-z0-9-]{1,40}$/.test(domain) || !verifyPublicIdentity(identity)) return false;
    return sodium.crypto_sign_verify_detached(bytes(signature), encoder.encode(`${PROTOCOL}:${domain}:${canonical(payload)}`), bytes(identity.signingPublicKey));
  } catch {
    return false;
  }
}

function exchangeStatement(publicKey: string): Uint8Array {
  return encoder.encode(`${EXCHANGE_DOMAIN}${publicKey}`);
}

function signedBytes(header: EnvelopeHeader, nonce: string, ciphertext: string): Uint8Array {
  return encoder.encode(`${SIGNING_DOMAIN}${canonical({ header, nonce, ciphertext })}`);
}

export async function ready(): Promise<void> {
  await sodium.ready;
}

export function verifyPublicIdentity(identity: PublicIdentity): boolean {
  try {
    const signingKey = bytes(identity.signingPublicKey);
    const exchangeKey = bytes(identity.exchangePublicKey);
    if (signingKey.length !== sodium.crypto_sign_PUBLICKEYBYTES || exchangeKey.length !== sodium.crypto_box_PUBLICKEYBYTES) return false;
    const computedId = sodium.to_hex(sodium.crypto_generichash(32, signingKey, null));
    return identity.deviceId === computedId &&
      sodium.crypto_sign_verify_detached(bytes(identity.exchangeProof), exchangeStatement(identity.exchangePublicKey), signingKey);
  } catch {
    return false;
  }
}

export function fingerprint(identity: PublicIdentity): string {
  if (!verifyPublicIdentity(identity)) throw new Error("设备身份无效");
  return identity.deviceId.match(/.{1,4}/g)?.join(" ") ?? identity.deviceId;
}

export class VaultSession {
  private locked = false;

  constructor(
    readonly publicIdentity: PublicIdentity,
    private secrets: VaultSecrets,
    private vaultKey: Uint8Array,
    private readonly salt: string,
    private readonly opsLimit: number,
    private readonly memLimit: number,
  ) {}

  private assertUnlocked(): void {
    if (this.locked) throw new Error("设备保险箱已锁定");
  }

  sign(message: Uint8Array): string {
    this.assertUnlocked();
    return b64(sodium.crypto_sign_detached(message, bytes(this.secrets.signingSecretKey)));
  }

  roomKey(roomId: string, epoch?: number): Uint8Array {
    this.assertUnlocked();
    const room = this.secrets.rooms[roomId];
    const selected = room?.keys[String(epoch ?? room.currentEpoch)];
    if (!selected) throw new Error("缺少房间密钥；请先与已验证成员同步");
    return bytes(selected);
  }

  currentEpoch(roomId: string): number {
    this.assertUnlocked();
    const room = this.secrets.rooms[roomId];
    if (!room) throw new Error("未知房间");
    return room.currentEpoch;
  }

  createRoom(roomId: string): void {
    this.assertUnlocked();
    if (this.secrets.rooms[roomId]) throw new Error("房间已存在");
    this.secrets.rooms[roomId] = { currentEpoch: 1, keys: { "1": b64(sodium.randombytes_buf(32)) } };
  }

  rotateRoomKey(roomId: string): number {
    this.assertUnlocked();
    const room = this.secrets.rooms[roomId];
    if (!room) throw new Error("未知房间");
    const epoch = room.currentEpoch + 1;
    room.currentEpoch = epoch;
    room.keys[String(epoch)] = b64(sodium.randombytes_buf(32));
    return epoch;
  }

  sealRoomKey(roomId: string, recipient: PublicIdentity, epoch = this.currentEpoch(roomId)): { roomId: string; epoch: number; sealedKey: string; signerDeviceId: string; signature: string } {
    this.assertUnlocked();
    if (!verifyPublicIdentity(recipient)) throw new Error("接收设备身份无效");
    const sealedKey = b64(sodium.crypto_box_seal(this.roomKey(roomId, epoch), bytes(recipient.exchangePublicKey)));
    const statement = canonical({ roomId, epoch, sealedKey, recipientDeviceId: recipient.deviceId });
    return { roomId, epoch, sealedKey, signerDeviceId: this.publicIdentity.deviceId, signature: this.sign(encoder.encode(`${PROTOCOL}:room-key:${statement}`)) };
  }

  openRoomKey(payload: { roomId: string; epoch: number; sealedKey: string; signerDeviceId: string; signature: string }, signer: PublicIdentity): void {
    this.assertUnlocked();
    if (!verifyPublicIdentity(signer) || payload.signerDeviceId !== signer.deviceId) throw new Error("密钥发放者身份无效");
    const statement = canonical({ roomId: payload.roomId, epoch: payload.epoch, sealedKey: payload.sealedKey, recipientDeviceId: this.publicIdentity.deviceId });
    if (!sodium.crypto_sign_verify_detached(bytes(payload.signature), encoder.encode(`${PROTOCOL}:room-key:${statement}`), bytes(signer.signingPublicKey))) {
      throw new Error("房间密钥签名验证失败");
    }
    const key = sodium.crypto_box_seal_open(bytes(payload.sealedKey), bytes(this.publicIdentity.exchangePublicKey), bytes(this.secrets.exchangeSecretKey));
    if (!key || key.length !== 32) throw new Error("房间密钥解封失败");
    const room = this.secrets.rooms[payload.roomId] ?? { currentEpoch: 0, keys: {} };
    room.keys[String(payload.epoch)] = b64(key);
    room.currentEpoch = Math.max(room.currentEpoch, payload.epoch);
    this.secrets.rooms[payload.roomId] = room;
  }

  encryptedRecord(): VaultRecord {
    this.assertUnlocked();
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      encoder.encode(JSON.stringify(this.secrets)), VAULT_AAD, null, nonce, this.vaultKey,
    );
    return {
      format: 1,
      publicIdentity: this.publicIdentity,
      kdf: { algorithm: "argon2id13", salt: this.salt, opsLimit: this.opsLimit, memLimit: this.memLimit },
      nonce: b64(nonce),
      ciphertext: b64(ciphertext),
    };
  }

  lock(): void {
    if (this.locked) return;
    sodium.memzero(this.vaultKey);
    // Secret strings cannot be reliably erased in JavaScript. Drop all references;
    // only the mutable derived vault key can be explicitly zeroed.
    this.secrets = { signingSecretKey: "", exchangeSecretKey: "", rooms: {} };
    this.locked = true;
  }
}

export async function createVault(name: string, passphrase: string): Promise<{ record: VaultRecord; session: VaultSession }> {
  await ready();
  if (!name.trim()) throw new Error("请输入设备名称");
  if (passphrase.length < 12) throw new Error("设备口令至少需要 12 个字符");
  const signing = sodium.crypto_sign_keypair();
  const exchange = sodium.crypto_box_keypair();
  const exchangePublicKey = b64(exchange.publicKey);
  const publicIdentity: PublicIdentity = {
    deviceId: sodium.to_hex(sodium.crypto_generichash(32, signing.publicKey, null)),
    name: name.trim().slice(0, 64),
    signingPublicKey: b64(signing.publicKey),
    exchangePublicKey,
    exchangeProof: b64(sodium.crypto_sign_detached(exchangeStatement(exchangePublicKey), signing.privateKey)),
  };
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const opsLimit = sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE;
  const memLimit = sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE;
  const vaultKey = sodium.crypto_pwhash(32, passphrase, salt, opsLimit, memLimit, sodium.crypto_pwhash_ALG_ARGON2ID13);
  const session = new VaultSession(publicIdentity, {
    signingSecretKey: b64(signing.privateKey), exchangeSecretKey: b64(exchange.privateKey), rooms: {},
  }, vaultKey, b64(salt), opsLimit, memLimit);
  sodium.memzero(signing.privateKey);
  sodium.memzero(exchange.privateKey);
  return { record: session.encryptedRecord(), session };
}

export async function unlockVault(record: VaultRecord, passphrase: string): Promise<VaultSession> {
  await ready();
  if (record.format !== 1 || record.kdf.algorithm !== "argon2id13" || !verifyPublicIdentity(record.publicIdentity)) {
    throw new Error("设备备份格式或身份无效");
  }
  if (record.kdf.opsLimit < 2 || record.kdf.memLimit < 64 * 1024 * 1024 || record.kdf.memLimit > 256 * 1024 * 1024) {
    throw new Error("设备备份密钥参数无效");
  }
  const key = sodium.crypto_pwhash(32, passphrase, bytes(record.kdf.salt), record.kdf.opsLimit, record.kdf.memLimit, sodium.crypto_pwhash_ALG_ARGON2ID13);
  try {
    const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, bytes(record.ciphertext), VAULT_AAD, bytes(record.nonce), key);
    const secrets = JSON.parse(sodium.to_string(plaintext)) as VaultSecrets;
    if (!secrets.signingSecretKey || !secrets.exchangeSecretKey || !secrets.rooms) throw new Error("invalid");
    if (!sodium.crypto_sign_verify_detached(bytes(record.publicIdentity.exchangeProof), exchangeStatement(record.publicIdentity.exchangePublicKey), bytes(record.publicIdentity.signingPublicKey))) throw new Error("invalid");
    return new VaultSession(record.publicIdentity, secrets, key, record.kdf.salt, record.kdf.opsLimit, record.kdf.memLimit);
  } catch {
    sodium.memzero(key);
    throw new Error("设备口令不正确或备份已损坏");
  }
}

export function encryptMessage(session: VaultSession, header: EnvelopeHeader, message: PlainMessage): SignedEnvelope {
  if (header.protocol !== PROTOCOL || header.senderDeviceId !== session.publicIdentity.deviceId) throw new Error("消息发送者不匹配");
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const encodedNonce = b64(nonce);
  const ciphertext = b64(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    encoder.encode(JSON.stringify(message)), encoder.encode(canonical(header)), null, nonce, session.roomKey(header.roomId, header.epoch),
  ));
  return { header, nonce: encodedNonce, ciphertext, signature: session.sign(signedBytes(header, encodedNonce, ciphertext)) };
}

export function verifyEnvelope(envelope: SignedEnvelope, sender: PublicIdentity): boolean {
  try {
    if (envelope.header.protocol !== PROTOCOL || envelope.header.senderDeviceId !== sender.deviceId || !verifyPublicIdentity(sender)) return false;
    if (!Number.isSafeInteger(envelope.header.senderSequence) || envelope.header.senderSequence < 1 || !Number.isSafeInteger(envelope.header.lamportTimestamp) || envelope.header.lamportTimestamp < 1) return false;
    if (bytes(envelope.nonce).length !== sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) return false;
    return sodium.crypto_sign_verify_detached(bytes(envelope.signature), signedBytes(envelope.header, envelope.nonce, envelope.ciphertext), bytes(sender.signingPublicKey));
  } catch {
    return false;
  }
}

export function decryptMessage(session: VaultSession, envelope: SignedEnvelope, sender: PublicIdentity): PlainMessage {
  if (!verifyEnvelope(envelope, sender)) throw new Error("消息签名验证失败");
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null, bytes(envelope.ciphertext), encoder.encode(canonical(envelope.header)), bytes(envelope.nonce), session.roomKey(envelope.header.roomId, envelope.header.epoch),
  );
  return JSON.parse(sodium.to_string(plaintext)) as PlainMessage;
}

export function newHeader(input: Omit<EnvelopeHeader, "protocol" | "messageId" | "createdAt">): EnvelopeHeader {
  return { protocol: PROTOCOL, messageId: crypto.randomUUID(), createdAt: Date.now(), ...input };
}

export async function encryptAttachment(session: VaultSession, roomId: string, epoch: number, attachmentId: string, plaintext: Uint8Array): Promise<{ encrypted: Uint8Array; sha256: string }> {
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const aad = encoder.encode(canonical({ protocol: PROTOCOL, roomId, epoch, attachmentId }));
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, session.roomKey(roomId, epoch));
  const encrypted = new Uint8Array(nonce.length + ciphertext.length);
  encrypted.set(nonce); encrypted.set(ciphertext, nonce.length);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encrypted)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { encrypted, sha256 };
}

export async function decryptAttachment(session: VaultSession, roomId: string, epoch: number, attachmentId: string, encrypted: Uint8Array, expectedSha256: string): Promise<Uint8Array> {
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(encrypted))), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expectedSha256 || encrypted.length < 40) throw new Error("附件 SHA-256 校验失败");
  const nonce = encrypted.subarray(0, sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = encrypted.subarray(nonce.length);
  const aad = encoder.encode(canonical({ protocol: PROTOCOL, roomId, epoch, attachmentId }));
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, aad, nonce, session.roomKey(roomId, epoch));
}
