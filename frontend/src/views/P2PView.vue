<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import QRCode from "qrcode";
import { createVault, unlockVault, type VaultRecord } from "../p2p/crypto";
import { identityCode, identityFingerprint } from "../p2p/identity";
import { P2PEngine, type VisibleMessage } from "../p2p/engine";
import { setActiveEngine } from "../p2p/active";
import { getSetting, listPeers, loadVault, saveSetting, saveVault, setPeerAlias, type PeerRecord, type RoomRecord } from "../p2p/storage";
import { decodeSignal, reassembleSignalParts, splitSignalCode } from "../p2p/signal";

const vault = ref<VaultRecord | null>(null);
const engine = shallowRef<P2PEngine | null>(null);
const deviceName = ref("");
const passphrase = ref("");
const roomName = ref("四人聊天室");
const rooms = ref<RoomRecord[]>([]);
const roomSummaries = ref<Record<string, { preview: string; unread: number; time: number }>>({});
const peers = ref<PeerRecord[]>([]);
const pairReports = ref<Record<string, string>>({});
const activeRoomId = ref("");
const visibleMessages = ref<VisibleMessage[]>([]);
const draft = ref("");
const searchQuery = ref("");
const replyTarget = ref<VisibleMessage | null>(null);
const inputCode = ref("");
const outputCode = ref("");
const qrImages = ref<string[]>([]);
const qrIndex = ref(0);
const scannedParts = ref<string[]>([]);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const stunText = ref("stun:stun.l.google.com:19302\nstun:stun1.l.google.com:19302");
const showPairing = ref(false);
const video = ref<HTMLVideoElement | null>(null);
let camera: MediaStream | null = null;
let scanTimer = 0;
let recorder: MediaRecorder | null = null;
let microphone: MediaStream | null = null;
const recording = ref(false);
const tab = ref<"messages" | "contacts" | "settings">("messages");
const myFingerprint = ref("");
const identityQr = ref("");
const peerFingerprints = ref<Record<string, string>>({});
const aliasDraft = ref<Record<string, string>>({});
const identityInput = ref("");
const scanningIdentityFor = ref("");
const remoteAudio = ref<HTMLAudioElement | null>(null);
const remoteAudioStream = shallowRef<MediaStream | null>(null);
watch(remoteAudio, (element) => { if (element && remoteAudioStream.value) { element.srcObject = remoteAudioStream.value; void element.play().catch(() => {}); } });
watch(tab, (value) => { if (value !== "contacts") stopCamera(); if (value === "messages") void refresh(); });

const activeRoom = computed(() => rooms.value.find((room) => room.roomId === activeRoomId.value));
const roomPeers = computed(() => peers.value.filter((peer) => activeRoom.value?.members.some((member) => member.deviceId === peer.deviceId)));
const directPeer = computed(() => activeRoom.value?.kind === "direct" ? roomPeers.value[0] : undefined);
const incomingCalls = computed(() => peers.value.filter((peer) => engine.value?.callFor(peer.deviceId)?.phase === "incoming"));
const filteredMessages = computed(() => visibleMessages.value.filter((message) => !searchQuery.value.trim() || message.body.toLowerCase().includes(searchQuery.value.trim().toLowerCase()) || message.attachmentName?.toLowerCase().includes(searchQuery.value.trim().toLowerCase())));

function roomLabel(room: RoomRecord): string {
  if (room.kind !== "direct" || !engine.value) return room.name;
  const other = room.members.find((member) => member.deviceId !== engine.value!.session.publicIdentity.deviceId);
  return peers.value.find((peer) => peer.deviceId === other?.deviceId)?.alias || other?.name || room.name;
}

async function refresh(): Promise<void> {
  if (!engine.value) return;
  rooms.value = await engine.value.rooms();
  roomSummaries.value = Object.fromEntries(await Promise.all(rooms.value.map(async (room) => {
    const items = await engine.value!.messages(room.roomId);
    const latest = items.at(-1);
    return [room.roomId, { preview: latest?.body || latest?.attachmentName || "暂无消息", unread: items.filter((item) => item.senderId !== engine.value!.session.publicIdentity.deviceId && item.lamport > room.lastReadLamport && item.body !== "[无法解密或密钥缺失]").length, time: latest?.createdAt ?? room.updatedAt }] as const;
  })));
  peers.value = await listPeers();
  for (const peer of peers.value) if (aliasDraft.value[peer.deviceId] === undefined) aliasDraft.value[peer.deviceId] = peer.alias ?? "";
  peerFingerprints.value = Object.fromEntries(await Promise.all(peers.value.map(async (peer) => [peer.deviceId, await identityFingerprint(peer.identity)] as const)));
  if (!activeRoomId.value && rooms.value.length) activeRoomId.value = rooms.value[0].roomId;
  if (activeRoomId.value) {
    visibleMessages.value = await engine.value.messages(activeRoomId.value);
    if (tab.value === "messages") void engine.value.readRoom(activeRoomId.value).catch((reason: unknown) => { error.value = reason instanceof Error ? reason.message : String(reason); });
  }
}

async function run(action: () => Promise<void>): Promise<void> {
  busy.value = true; error.value = ""; notice.value = "";
  try { await action(); await refresh(); }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { busy.value = false; }
}

function urls(): string[] {
  const list = stunText.value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
  if (list.length > 8) throw new Error("最多配置 8 个 STUN 节点");
  return list;
}

function activate(session: Awaited<ReturnType<typeof unlockVault>>): void {
  engine.value?.close();
  engine.value = new P2PEngine(session, urls());
  setActiveEngine(engine.value);
  engine.value.onChange = () => { void refresh().catch((reason: unknown) => { error.value = reason instanceof Error ? reason.message : String(reason); }); };
  engine.value.onError = (message) => { error.value = message; };
  engine.value.onRemoteAudio = (_deviceId, stream) => { remoteAudioStream.value = stream; void nextTick(() => { if (remoteAudio.value) { remoteAudio.value.srcObject = stream; void remoteAudio.value.play().catch(() => {}); } }); };
  passphrase.value = "";
  void identityFingerprint(session.publicIdentity).then((value) => { myFingerprint.value = value; });
  void QRCode.toDataURL(identityCode(session.publicIdentity), { width: 280, margin: 2, errorCorrectionLevel: "M" }).then((value) => { identityQr.value = value; });
  void refresh();
}

function createDevice(): void { void run(async () => {
  const result = await createVault(deviceName.value, passphrase.value);
  await saveVault(result.record);
  vault.value = result.record;
  activate(result.session);
}); }

function unlockDevice(): void { void run(async () => {
  if (!vault.value) throw new Error("没有本地设备");
  activate(await unlockVault(vault.value, passphrase.value));
}); }

function lockDevice(): void {
  if (recorder?.state === "recording") { recorder.onstop = null; recorder.stop(); }
  microphone?.getTracks().forEach((track) => track.stop()); microphone = null; recording.value = false;
  stopCamera(); engine.value?.close(); engine.value = null;
  setActiveEngine(null);
  visibleMessages.value = []; outputCode.value = ""; qrImages.value = [];
  notice.value = "设备已锁定，重新打开后需重新交换连接码";
}

function addRoom(): void { void run(async () => {
  const room = await engine.value!.createRoom(roomName.value);
  activeRoomId.value = room.roomId;
}); }

function send(): void { void run(async () => {
  if (!activeRoomId.value) throw new Error("请先创建或加入房间");
  await engine.value!.sendText(activeRoomId.value, draft.value, replyTarget.value?.id);
  draft.value = "";
  replyTarget.value = null;
}); }

function revokeMessage(messageId: string): void { void run(async () => { await engine.value!.revoke(activeRoomId.value, messageId); }); }
function reactMessage(messageId: string, emoji: string): void { void run(async () => { await engine.value!.react(activeRoomId.value, messageId, emoji); }); }
function retryMessage(messageId: string): void { void run(async () => { await engine.value!.retryMessage(messageId); notice.value = "已尝试重发；等待对端确认送达"; }); }
function cancelPending(messageId: string): void { void run(async () => { await engine.value!.cancelPending(messageId); notice.value = "已停止后续重发；已到达对方设备的副本无法收回"; }); }
function copyMessage(body: string): void { void run(async () => { await navigator.clipboard.writeText(body); notice.value = "消息已复制"; }); }
function deleteMessage(messageId: string): void { if (!window.confirm("只删除本机这条消息及附件副本？其他设备已保存的内容不会删除。")) return; void run(async () => { await engine.value!.deleteMessageLocally(messageId); notice.value = "已删除本机消息"; }); }
function deleteChatHistory(): void { if (!activeRoomId.value || !window.confirm("删除本机当前会话的全部聊天记录和待发消息？此操作无法从本机撤销。")) return; void run(async () => { const count = await engine.value!.deleteRoomHistoryLocally(activeRoomId.value); notice.value = `已从本机删除 ${count} 条记录`; }); }

function sendFile(event: Event): void { void run(async () => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = "";
  if (!file || !activeRoomId.value) throw new Error("请选择房间和文件");
  await engine.value!.sendAttachment(activeRoomId.value, file);
  notice.value = "附件已在本机加密保存，正在向在线成员传输密文";
}); }

function downloadFile(messageId: string): void { void run(async () => {
  const result = await engine.value!.attachmentBlob(messageId);
  const url = URL.createObjectURL(result.blob);
  if (result.blob.type.startsWith("audio/")) {
    const audio = new Audio(url);
    audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
    audio.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
    await audio.play(); return;
  }
  const link = document.createElement("a"); link.href = url; link.download = result.name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}); }

function toggleRecording(): void { void run(async () => {
  if (recorder?.state === "recording") { recorder.stop(); recording.value = false; return; }
  if (!activeRoomId.value || typeof MediaRecorder === "undefined") throw new Error("请先选择房间，并使用支持录音的浏览器");
  microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ["audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
  recorder = new MediaRecorder(microphone, mime ? { mimeType: mime } : undefined);
  const parts: BlobPart[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
  recorder.onstop = () => {
    microphone?.getTracks().forEach((track) => track.stop()); microphone = null;
    const type = recorder?.mimeType || "audio/webm";
    const extension = type.includes("mp4") ? "m4a" : "webm";
    const file = new File(parts, `voice-${Date.now()}.${extension}`, { type });
    void run(async () => { await engine.value!.sendAttachment(activeRoomId.value, file); notice.value = "语音消息已加密并开始同步"; });
  };
  recorder.start(); recording.value = true;
}); }

async function showCode(code: string): Promise<void> {
  outputCode.value = code;
  const signal = await decodeSignal(code);
  try {
    const parts = await splitSignalCode(code, signal.pairingId);
    qrImages.value = await Promise.all(parts.map((part) => QRCode.toDataURL(part, { width: 280, margin: 2, errorCorrectionLevel: "M" })));
    qrIndex.value = 0;
    notice.value = parts.length > 1 ? `连接码共 ${parts.length} 个二维码，逐张展示给对方扫描` : "请让对方扫描二维码或安全地交换文本连接码";
  } catch {
    qrImages.value = [];
    notice.value = "连接码超过二维码容量，请使用文本或本地文件交换";
  }
}

function makeOffer(): void { outputCode.value = ""; qrImages.value = []; void run(async () => { await showCode(await engine.value!.offer(activeRoomId.value || undefined)); }); }
function acceptOffer(): void { outputCode.value = ""; qrImages.value = []; void run(async () => { await showCode(await engine.value!.answer(inputCode.value)); inputCode.value = ""; }); }
function acceptAnswer(): void { void run(async () => {
  const peer = await engine.value!.finish(inputCode.value);
  inputCode.value = ""; notice.value = `已接收 ${peer.name} 的应答；请等待连接并当面核对指纹`;
}); }

function trust(deviceId: string): void { void run(async () => {
  await engine.value!.trustPeer(deviceId);
  notice.value = "已验证本次连接与设备身份，并保存信任记录";
}); }

function trustCode(deviceId: string): void { void run(async () => {
  await engine.value!.trustByIdentityCode(deviceId, identityInput.value.trim());
  identityInput.value = "";
  notice.value = "二维码身份与当前连接一致，已信任设备";
}); }

function direct(deviceId: string): void { void run(async () => {
  const room = await engine.value!.createDirect(deviceId);
  activeRoomId.value = room.roomId;
  tab.value = "messages";
}); }

function startCall(): void { void run(async () => {
  if (!activeRoom.value || !directPeer.value) throw new Error("请先打开已认证的私聊");
  await engine.value!.startCall(activeRoom.value.roomId, directPeer.value.deviceId);
  notice.value = "正在呼叫，请等待对方接听";
}); }

function acceptCall(deviceId: string): void { void run(async () => {
  const room = rooms.value.find((item) => item.kind === "direct" && item.members.some((member) => member.deviceId === deviceId));
  if (room) { activeRoomId.value = room.roomId; tab.value = "messages"; }
  await engine.value!.acceptCall(deviceId);
  notice.value = "语音通话已接通";
}); }

function endCall(deviceId: string): void { void run(async () => {
  await engine.value!.endCall(deviceId);
  remoteAudioStream.value = null;
  if (remoteAudio.value) remoteAudio.value.srcObject = null;
  notice.value = "通话已结束";
}); }

function revokePeer(deviceId: string): void { void run(async () => {
  await engine.value!.revokeTrust(deviceId);
  notice.value = "已撤销信任；重新认证前不能收发消息";
}); }

function saveAlias(deviceId: string): void { void run(async () => { await setPeerAlias(deviceId, aliasDraft.value[deviceId] ?? ""); notice.value = "设备备注已保存"; }); }

function copyFingerprint(): void { void run(async () => {
  await navigator.clipboard.writeText(myFingerprint.value);
  notice.value = "本机身份指纹已复制";
}); }

function scanIdentity(deviceId: string): void {
  scanningIdentityFor.value = deviceId;
  showPairing.value = true;
  void nextTick(() => startCamera());
}

function invite(deviceId: string): void { void run(async () => {
  await engine.value!.invite(activeRoomId.value, deviceId);
  notice.value = "已通过端到端连接发送加密房间密钥";
}); }

function restart(deviceId: string): void { outputCode.value = ""; qrImages.value = []; void run(async () => { await showCode(await engine.value!.restartOffer(deviceId)); showPairing.value = true; }); }
function removeMember(deviceId: string): void { void run(async () => {
  await engine.value!.removeMember(activeRoomId.value, deviceId);
  notice.value = "成员已从本机房间名单移除，房间密钥已轮换；离线成员要在重新连接后才能收到更新";
}); }
function inspectPath(deviceId: string): void { void run(async () => {
  const pair = await engine.value!.links.get(deviceId)?.selectedCandidatePair();
  pairReports.value = { ...pairReports.value, [deviceId]: pair ? `${pair.localType} ↔ ${pair.remoteType} · ${pair.protocol} · RTT ${pair.rttMs ?? '未知'} ms` : "尚无选中的实际连接路径" };
}); }

function chooseRoom(roomId: string): void { activeRoomId.value = roomId; replyTarget.value = null; searchQuery.value = ""; void refresh(); }

function exportBackup(): void {
  if (!engine.value) return;
  const data = engine.value.session.encryptedRecord();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = "aether-encrypted-device-backup.json"; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function importBackup(event: Event): void { void run(async () => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file || file.size > 1_000_000) throw new Error("备份文件无效或过大");
  const record = JSON.parse(await file.text()) as VaultRecord;
  await unlockVault(record, passphrase.value).then((session) => session.lock());
  await saveVault(record); vault.value = record;
  notice.value = "加密设备备份已导入，请输入口令解锁";
}); }

async function scanFrame(): Promise<void> {
  if (!camera || !video.value || video.value.readyState < 2) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.value.videoWidth; canvas.height = video.value.videoHeight;
  if (!canvas.width || !canvas.height) return;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.drawImage(video.value, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const jsQR = (await import("jsqr")).default;
  const result = jsQR(pixels.data, pixels.width, pixels.height);
  if (!result) return;
  const value = result.data.trim();
  if (value.startsWith("aether-id1:")) {
    stopCamera();
    if (!scanningIdentityFor.value) { identityInput.value = value; notice.value = "已扫描身份二维码；请在联系人中选择对应设备"; return; }
    const peerId = scanningIdentityFor.value; scanningIdentityFor.value = "";
    trustCodeFromScan(peerId, value); return;
  }
  if (value.startsWith("aether1:")) { inputCode.value = value; stopCamera(); notice.value = "已扫描完整连接码"; return; }
  if (!value.startsWith("aether-part1.") || scannedParts.value.includes(value)) return;
  scannedParts.value.push(value);
  const reassembled = await reassembleSignalParts(scannedParts.value);
  notice.value = `已扫描 ${reassembled.received}/${reassembled.total} 张二维码`;
  if (reassembled.complete && reassembled.code) { inputCode.value = reassembled.code; stopCamera(); notice.value = "连接码已重组并校验"; }
}

function trustCodeFromScan(deviceId: string, code: string): void { void run(async () => {
  await engine.value!.trustByIdentityCode(deviceId, code);
  notice.value = "身份二维码已核对，当前加密连接已认证";
}); }

function startCamera(): void { void run(async () => {
  camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  if (!video.value) throw new Error("摄像头界面不可用");
  video.value.srcObject = camera; await video.value.play();
  scanTimer = window.setInterval(() => { void scanFrame().catch((reason: unknown) => { error.value = reason instanceof Error ? reason.message : String(reason); }); }, 350);
}); }

function stopCamera(): void {
  window.clearInterval(scanTimer); camera?.getTracks().forEach((track) => track.stop()); camera = null;
  if (video.value) video.value.srcObject = null;
}

function copyCode(): void { void run(async () => { await navigator.clipboard.writeText(outputCode.value); notice.value = "连接码已复制"; }); }

onMounted(async () => {
  try {
    vault.value = (await loadVault()) ?? null;
    stunText.value = (await getSetting<string>("stun-urls")) ?? stunText.value;
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
});
onBeforeUnmount(() => { stopCamera(); if (recorder?.state === "recording") { recorder.onstop = null; recorder.stop(); } microphone?.getTracks().forEach((track) => track.stop()); engine.value?.close(); setActiveEngine(null); });
</script>

<template>
  <section class="p2p">
    <header class="p2p__head"><h1>私人聊天</h1><span class="tag">本地 P2P</span></header>
    <p class="hint">消息只保存在参与设备中。连接码交换时可能暴露网络地址；请只发给要连接的人。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>

    <div v-if="!engine" class="panel">
      <h2>{{ vault ? "解锁本机设备" : "创建本机设备" }}</h2>
      <input v-if="!vault" v-model="deviceName" placeholder="设备名称" autocomplete="off" />
      <input v-model="passphrase" type="password" placeholder="设备口令，至少 12 个字符" autocomplete="off" />
      <button :disabled="busy" @click="vault ? unlockDevice() : createDevice()">{{ vault ? "解锁" : "创建设备" }}</button>
      <label v-if="!vault" class="file-label">已有加密备份？导入<input type="file" accept="application/json,.json" @change="importBackup" /></label>
      <p class="hint">口令丢失且无加密备份时，设备密钥与仅存在该设备上的消息无法恢复。</p>
    </div>

    <template v-else>
      <div v-for="peer in incomingCalls" :key="peer.deviceId" class="panel"><strong>{{ peer.alias || peer.identity.name }} 发来语音通话</strong><div class="actions"><button @click="acceptCall(peer.deviceId)">接听</button><button @click="endCall(peer.deviceId)">拒绝</button></div></div>
      <div v-if="tab === 'settings'" class="panel"><h2>我的设备身份</h2><p>{{ engine.session.publicIdentity.name }}</p><p class="hint">设备 ID</p><p class="fingerprint">{{ engine.session.publicIdentity.deviceId }}</p><p class="hint">完整 SHA-256 身份指纹</p><p class="fingerprint">{{ myFingerprint }}</p><img v-if="identityQr" class="qr" :src="identityQr" alt="本机公开身份二维码" /><div class="actions"><button @click="copyFingerprint">复制身份指纹</button><button @click="exportBackup">导出加密设备密钥</button><button @click="lockDevice">锁定</button></div><p class="hint">二维码只包含公开身份，不包含私钥。加密备份只含设备和房间密钥，不含聊天记录与附件。</p></div>
      <div v-if="tab === 'messages'" class="panel"><div class="row"><h2>消息</h2><button @click="addRoom" :disabled="busy">创建群聊</button></div><input v-model="roomName" placeholder="群聊名称" /><div class="room-list"><button v-for="room in rooms" :key="room.roomId" :class="{ active: activeRoomId === room.roomId }" @click="chooseRoom(room.roomId)"><span>{{ room.kind === 'direct' ? '私聊 · ' : '群聊 · ' }}{{ roomLabel(room) }} · {{ room.removedAt ? '已移除' : `${room.members.length}/4` }}</span><small>{{ roomSummaries[room.roomId]?.preview }} · {{ new Date(roomSummaries[room.roomId]?.time ?? room.updatedAt).toLocaleString() }}<b v-if="roomSummaries[room.roomId]?.unread"> · 未读 {{ roomSummaries[room.roomId]?.unread }}</b></small></button></div></div>
      <div v-if="tab === 'messages' && activeRoom" class="panel chat-panel"><h2>{{ activeRoom.kind === 'direct' ? '私聊 · ' : '群聊 · ' }}{{ roomLabel(activeRoom) }}</h2><div v-if="directPeer" class="actions"><button v-if="!engine.callFor(directPeer.deviceId)" :disabled="!engine.authFor(directPeer.deviceId)?.trusted || !engine.links.get(directPeer.deviceId)?.ready" @click="startCall">语音通话</button><span v-else>{{ engine.callFor(directPeer.deviceId)?.phase === 'calling' ? '呼叫中' : '通话中' }}</span><button v-if="engine.callFor(directPeer.deviceId)" @click="endCall(directPeer.deviceId)">挂断</button></div><audio v-if="directPeer && engine.callFor(directPeer.deviceId)" ref="remoteAudio" controls autoplay playsinline aria-label="对方语音"></audio><button @click="deleteChatHistory">删除本机会话记录</button><p v-if="activeRoom.removedAt" class="error">房主已将本设备移出房间；历史仍在本机，新消息无法发送。</p><p v-else class="hint">{{ roomPeers.filter((peer) => engine?.links.get(peer.deviceId)?.ready && engine?.authFor(peer.deviceId)?.trusted).length }} 台成员设备已连接并认证 · 最多四人</p><input v-model="searchQuery" placeholder="搜索本机消息" /><div class="messages"><p v-if="!filteredMessages.length" class="hint">没有匹配的真实消息</p><article v-for="message in filteredMessages" :key="message.id" class="message"><b>{{ message.sender }}</b><small v-if="message.replyTo">回复消息 {{ message.replyTo.slice(0, 8) }}</small><span v-if="!message.attachmentId">{{ message.body }}</span><button v-else :disabled="!message.attachmentReady" @click="downloadFile(message.id)">{{ message.attachmentReady ? (message.kind === 'voice' ? '播放' : '下载') : '同步中' }} · {{ message.attachmentName }} ({{ message.attachmentBytes }} 字节)</button><small>{{ new Date(message.createdAt).toLocaleString() }} · {{ message.senderId === engine.session.publicIdentity.deviceId ? (message.deliveryState || '等待发送') : '已保存在本机' }} · {{ message.replicas }} 份副本</small><div v-if="!activeRoom.removedAt && !message.deleted" class="actions"><button @click="replyTarget = message">回复</button><button v-if="!message.attachmentId" @click="copyMessage(message.body)">复制</button><button @click="deleteMessage(message.id)">本地删除</button><button @click="reactMessage(message.id, '👍')">👍 {{ message.reactions?.['👍'] ?? '' }}</button><button v-if="message.senderId === engine.session.publicIdentity.deviceId" @click="revokeMessage(message.id)">撤回</button><button v-if="message.senderId === engine.session.publicIdentity.deviceId && (message.deliveryState === '等待发送' || message.deliveryState === '部分送达') && activeRoom.members.length > 1" @click="retryMessage(message.id)">重试</button><button v-if="message.senderId === engine.session.publicIdentity.deviceId && (message.deliveryState === '等待发送' || message.deliveryState === '部分送达') && activeRoom.members.length > 1" @click="cancelPending(message.id)">取消后续发送</button></div></article></div><p v-if="replyTarget" class="hint">回复 {{ replyTarget.sender }}：{{ replyTarget.body }} <button @click="replyTarget = null">取消</button></p><div v-if="!activeRoom.removedAt" class="compose"><textarea v-model="draft" placeholder="输入加密文字消息" rows="2" /><button :disabled="busy || !draft.trim()" @click="send">发送</button></div><div v-if="!activeRoom.removedAt" class="actions"><label class="file-label">发送图片或文件（最多 2 MiB）<input type="file" @change="sendFile" /></label><button @click="toggleRecording">{{ recording ? '结束并发送语音' : '录制语音' }}</button></div><p class="hint">只有本机保存时仅有 1 份副本，设备丢失可能导致消息无法恢复。撤回无法删除对方已保存的内容。</p></div>
      <div v-if="tab === 'contacts'" class="panel"><div class="row"><h2>添加设备</h2><button @click="showPairing = !showPairing">{{ showPairing ? "收起" : "展开" }}</button></div><template v-if="showPairing"><textarea v-model="stunText" rows="2" aria-label="STUN 地址，每行一个" @change="saveSetting('stun-urls', stunText)"></textarea><p class="hint">公共 STUN 地址只是默认候选，尚未经过你所在网络验证；不使用 TURN。</p><button :disabled="busy" @click="makeOffer">生成发起码</button><textarea v-model="inputCode" rows="3" placeholder="粘贴收到的发起码或应答码"></textarea><div class="actions"><button :disabled="busy || !inputCode" @click="acceptOffer">接收发起码并生成应答</button><button :disabled="busy || !inputCode" @click="acceptAnswer">完成应答</button><button @click="startCamera">扫码</button></div><video ref="video" class="camera" playsinline muted></video><button @click="stopCamera">关闭摄像头</button><p v-if="scannedParts.length" class="hint">已收集 {{ scannedParts.length }} 张二维码分片</p><template v-if="outputCode"><img v-if="qrImages.length" class="qr" :src="qrImages[qrIndex]" alt="本地生成的连接二维码" /><div class="actions"><button :disabled="qrIndex === 0" @click="qrIndex--">上一张</button><span>{{ qrIndex + 1 }}/{{ qrImages.length }}</span><button :disabled="qrIndex >= qrImages.length - 1" @click="qrIndex++">下一张</button></div><textarea :value="outputCode" readonly rows="3" aria-label="本机连接码"></textarea><button @click="copyCode">复制连接码</button></template></template></div>
      <div v-if="tab === 'contacts'" class="panel"><h2>联系人</h2><p v-if="!peers.length" class="hint">暂无设备。双方交换连接码后，连接成功才会出现。</p><article v-for="peer in peers" :key="peer.deviceId" class="peer"><strong>{{ peer.alias || peer.identity.name }}</strong><div class="actions"><input v-model="aliasDraft[peer.deviceId]" placeholder="设备备注" maxlength="64" /><button @click="saveAlias(peer.deviceId)">保存备注</button></div><span>{{ engine.links.get(peer.deviceId)?.status ?? "disconnected" }} · {{ peer.revokedAt ? '已撤销信任' : engine.authFor(peer.deviceId)?.failed ? '认证失败' : engine.authFor(peer.deviceId)?.trusted ? '已验证并信任' : engine.authFor(peer.deviceId)?.proofVerified ? '尚未验证' : engine.links.get(peer.deviceId)?.ready ? '正在验证' : '当前未连接' }}</span><p class="fingerprint">完整 SHA-256 指纹：{{ peerFingerprints[peer.deviceId] }}</p><template v-if="engine.authFor(peer.deviceId)?.proofVerified && !engine.authFor(peer.deviceId)?.trusted"><p class="hint">请与对方当面比较本次连接的安全验证码，或扫描对方手机设置页的身份二维码。完整指纹可用于备用核对。</p><p class="sas">{{ engine.authFor(peer.deviceId)?.sas }}</p><div class="actions"><button @click="trust(peer.deviceId)">验证码相同，确认信任</button><button @click="scanIdentity(peer.deviceId)">扫描对方身份二维码</button></div><textarea v-model="identityInput" rows="2" placeholder="也可粘贴对方公开身份码"></textarea><button :disabled="!identityInput" @click="trustCode(peer.deviceId)">核对身份码并信任</button></template><p v-if="pairReports[peer.deviceId]" class="hint">实际连接：{{ pairReports[peer.deviceId] }}</p><div class="actions"><button v-if="engine.authFor(peer.deviceId)?.trusted" @click="direct(peer.deviceId)">发起私聊</button><button v-if="engine.links.get(peer.deviceId)?.ready" @click="inspectPath(peer.deviceId)">查看实际连接路径</button><button v-if="engine.authFor(peer.deviceId)?.trusted && activeRoom?.kind !== 'direct' && activeRoom && !activeRoom.members.some((member) => member.deviceId === peer.deviceId)" @click="invite(peer.deviceId)">邀请加入当前群聊</button><button v-if="activeRoom?.kind !== 'direct' && activeRoom?.ownerDeviceId === engine.session.publicIdentity.deviceId && activeRoom.members.some((member) => member.deviceId === peer.deviceId)" @click="removeMember(peer.deviceId)">移除并轮换密钥</button><button v-if="peer.verifiedAt && engine.links.get(peer.deviceId) && !engine.links.get(peer.deviceId)?.ready" @click="restart(peer.deviceId)">重新交换连接码</button><button v-if="peer.verifiedAt" @click="revokePeer(peer.deviceId)">撤销信任</button></div></article></div>
      <p v-if="tab === 'contacts'" class="hint">手机熄屏或 PWA 进入后台时，连接可能暂停。网络变化后若无法恢复，请重新交换连接码。</p>
      <div v-if="tab === 'settings'" class="panel"><h2>网络诊断与数据</h2><p class="hint">本机数据保存在浏览器中；清理网站数据可能导致永久丢失。语音消息需要麦克风权限。</p><RouterLink to="/network-test">打开网络连通性测试</RouterLink></div>
      <nav class="bottom-nav" aria-label="主导航"><button :class="{ active: tab === 'messages' }" @click="tab = 'messages'">消息</button><button :class="{ active: tab === 'contacts' }" @click="tab = 'contacts'">联系人</button><button :class="{ active: tab === 'settings' }" @click="tab = 'settings'">设置</button></nav>
    </template>
  </section>
</template>

<style scoped>
.p2p{max-width:820px;margin:auto;padding:20px 16px 80px;color:var(--ae-text)}.p2p__head,.row,.actions,.compose{display:flex;align-items:center;gap:10px}.p2p__head,.row{justify-content:space-between}.p2p h1{font-size:26px}.p2p h2{font-size:17px;margin:0 0 12px}.tag{color:var(--ae-accent);background:var(--ae-accent-soft);border-radius:99px;padding:5px 10px}.panel{background:var(--ae-bg-elev);border:1px solid var(--ae-border);border-radius:var(--ae-radius);padding:18px;margin:16px 0}.hint{font-size:12px;color:var(--ae-text-muted);line-height:1.5}.error,.notice{padding:10px;border-radius:8px}.error{color:var(--ae-danger);background:rgba(255,107,107,.1)}.notice{color:var(--ae-accent);background:var(--ae-accent-soft)}input,textarea{display:block;width:100%;box-sizing:border-box;background:var(--ae-bg-elev-2);border:1px solid var(--ae-border);border-radius:10px;color:var(--ae-text);padding:11px;margin:10px 0;font:inherit}button,.file-label{border:1px solid var(--ae-border-strong);border-radius:10px;background:var(--ae-accent-soft);color:var(--ae-text);padding:10px;cursor:pointer;font:inherit}button:disabled{opacity:.45;cursor:default}.file-label input{display:none}.fingerprint{font-family:var(--ae-font-mono);font-size:11px;line-break:anywhere;color:var(--ae-text-muted)}.actions{flex-wrap:wrap}.room-list{display:flex;gap:8px;overflow:auto}.room-list .active{border-color:var(--ae-accent);color:var(--ae-accent)}.messages{max-height:380px;min-height:100px;overflow:auto}.message,.peer{display:flex;flex-direction:column;gap:5px;padding:10px 0;border-bottom:1px solid var(--ae-border)}.message small,.peer span{color:var(--ae-text-muted)}.compose textarea{flex:1}.qr{display:block;width:min(280px,100%);margin:12px auto}.camera{display:block;max-width:100%;max-height:240px;margin:auto}.camera:not([src]){min-height:0}
.bottom-nav{position:sticky;bottom:0;display:flex;justify-content:space-around;gap:8px;padding:10px;background:var(--ae-bg-elev);border:1px solid var(--ae-border);border-radius:14px}.bottom-nav button{flex:1}.bottom-nav .active{border-color:var(--ae-accent);color:var(--ae-accent)}.sas{font:700 24px var(--ae-font-mono);letter-spacing:3px;color:var(--ae-accent)}
.room-list button{display:flex;flex-direction:column;text-align:left;min-width:160px;gap:5px}.room-list small{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ae-text-muted)}
</style>
