import type { PublicIdentity, VaultSession } from "./crypto";
import { createSignal, decodeSignal, encodeSignal, signalDigest, type SignedSignal } from "./signal";

export type PeerConnectionStatus = "waiting_for_pairing" | "connecting" | "connected" | "disconnected" | "reconnecting" | "failed";

export interface CandidatePairReport {
  localType: string;
  remoteType: string;
  protocol: string;
  rttMs: number | null;
  bytesSent: number;
  bytesReceived: number;
}

export interface PeerLinkHandlers {
  onStatus?: (status: PeerConnectionStatus) => void;
  onFrame?: (frame: unknown, from: PublicIdentity) => void | Promise<void>;
  onError?: (message: string) => void;
}

function validateStunUrls(urls: string[]): RTCIceServer[] {
  if (urls.length > 8) throw new Error("最多配置 8 个 STUN 地址");
  return urls.map((raw) => {
    const url = raw.trim();
    if (!/^stuns?:[A-Za-z0-9.\-\[\]:]+(?:\?transport=(?:udp|tcp))?$/i.test(url) || /turn/i.test(url)) {
      throw new Error("仅允许 stun: 或 stuns: 地址，禁止 TURN");
    }
    return { urls: url };
  });
}

function rejectRelayCandidate(sdp: string): void {
  if (/^a=candidate:.*\btyp relay\b/im.test(sdp)) throw new Error("连接码包含 TURN relay Candidate，已拒绝");
}

function gatheredDescription(connection: RTCPeerConnection, expected: "offer" | "answer", timeoutMs = 20_000): Promise<RTCSessionDescriptionInit> {
  return new Promise((resolve, reject) => {
    let timer = 0;
    const finish = () => {
      window.clearTimeout(timer);
      connection.removeEventListener("icegatheringstatechange", onChange);
      const current = connection.localDescription;
      if (!current || current.type !== expected || !current.sdp) reject(new Error("WebRTC 未生成完整协商信息"));
      else if (connection.iceGatheringState !== "complete") reject(new Error("ICE Candidate 收集超时，请重试或改用文本连接码"));
      else resolve({ type: expected, sdp: current.sdp });
    };
    const onChange = () => {
      if (connection.iceGatheringState === "complete") finish();
    };
    connection.addEventListener("icegatheringstatechange", onChange);
    timer = window.setTimeout(finish, timeoutMs);
    onChange();
  });
}

export class ManualPeerLink {
  readonly connection: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private remote: PublicIdentity | null = null;
  private pendingOffer: { pairingId: string; digest: string } | null = null;
  private statusValue: PeerConnectionStatus = "waiting_for_pairing";
  private frameQueue: Promise<void> = Promise.resolve();
  private readonly handlers: PeerLinkHandlers;

  constructor(private readonly session: VaultSession, stunUrls: string[], handlers: PeerLinkHandlers = {}) {
    if (typeof RTCPeerConnection === "undefined") throw new Error("此浏览器不支持 WebRTC");
    this.handlers = handlers;
    this.connection = new RTCPeerConnection({ iceServers: validateStunUrls(stunUrls), iceTransportPolicy: "all", bundlePolicy: "max-bundle" });
    this.connection.ondatachannel = (event) => this.attachChannel(event.channel);
    this.connection.addEventListener("connectionstatechange", () => this.updateStatus());
    this.connection.addEventListener("iceconnectionstatechange", () => this.updateStatus());
  }

  get status(): PeerConnectionStatus { return this.statusValue; }
  get remoteIdentity(): PublicIdentity | null { return this.remote; }
  get expectsAnswer(): boolean { return this.pendingOffer !== null; }
  get ready(): boolean { return this.channel?.readyState === "open" && this.connection.connectionState === "connected"; }

  private setStatus(next: PeerConnectionStatus): void {
    if (next === this.statusValue) return;
    this.statusValue = next;
    this.handlers.onStatus?.(next);
  }

  private updateStatus(): void {
    const state = this.connection.connectionState;
    const ice = this.connection.iceConnectionState;
    if (state === "failed" || ice === "failed") this.setStatus("failed");
    else if (state === "connected" && this.channel?.readyState === "open") this.setStatus("connected");
    else if (state === "disconnected" || ice === "disconnected") this.setStatus("disconnected");
    else if (state === "connecting" || ice === "checking") this.setStatus("connecting");
  }

  private attachChannel(channel: RTCDataChannel): void {
    if (channel.label !== "aether-p2p-v1" || this.channel?.readyState === "open") {
      channel.close();
      return;
    }
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 128 * 1024;
    channel.onopen = () => this.updateStatus();
    channel.onclose = () => this.setStatus("disconnected");
    channel.onerror = () => this.handlers.onError?.("DataChannel 传输错误");
    channel.onmessage = (event) => {
      if (typeof event.data !== "string" || event.data.length > 256 * 1024 || !this.remote) {
        this.handlers.onError?.("收到无效或过大的 P2P 数据帧");
        return;
      }
      try {
        const frame: unknown = JSON.parse(event.data);
        const remote = this.remote;
        this.frameQueue = this.frameQueue.then(async () => {
          await this.handlers.onFrame?.(frame, remote);
        }).catch((error: unknown) => {
          this.handlers.onError?.(error instanceof Error ? error.message : "P2P 数据处理失败");
        });
      } catch {
        this.handlers.onError?.("P2P 数据帧格式无效");
      }
    };
  }

  async createOffer(roomId?: string, restart = false): Promise<{ code: string; signal: SignedSignal }> {
    if (restart && !this.remote) throw new Error("没有可重连的设备");
    if (!restart && this.channel) throw new Error("当前连接已发起配对");
    if (!this.channel) this.attachChannel(this.connection.createDataChannel("aether-p2p-v1", { ordered: true }));
    this.setStatus(restart ? "reconnecting" : "connecting");
    const pairingId = crypto.randomUUID();
    const offer = await this.connection.createOffer({ iceRestart: restart });
    await this.connection.setLocalDescription(offer);
    const description = await gatheredDescription(this.connection, "offer");
    rejectRelayCandidate(description.sdp ?? "");
    const signal = createSignal(this.session, { kind: "offer", pairingId, description, roomId });
    const code = encodeSignal(signal);
    this.pendingOffer = { pairingId, digest: await signalDigest(code) };
    return { code, signal };
  }

  async acceptOffer(code: string): Promise<{ code: string; signal: SignedSignal }> {
    const offer = await decodeSignal(code);
    if (offer.kind !== "offer" || offer.from.deviceId === this.session.publicIdentity.deviceId) throw new Error("无效的发起连接码");
    if (this.remote && this.remote.deviceId !== offer.from.deviceId) throw new Error("重连设备身份与原设备不符");
    rejectRelayCandidate(offer.sdp.sdp);
    this.remote = offer.from;
    this.setStatus("connecting");
    await this.connection.setRemoteDescription(offer.sdp);
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);
    const description = await gatheredDescription(this.connection, "answer");
    rejectRelayCandidate(description.sdp ?? "");
    const signal = createSignal(this.session, {
      kind: "answer", pairingId: offer.pairingId, description,
      toDeviceId: offer.from.deviceId, roomId: offer.roomId, offerDigest: await signalDigest(code),
    });
    return { code: encodeSignal(signal), signal };
  }

  async acceptAnswer(code: string): Promise<PublicIdentity> {
    if (!this.pendingOffer) throw new Error("没有等待中的发起连接码");
    const answer = await decodeSignal(code);
    if (answer.kind !== "answer" || answer.pairingId !== this.pendingOffer.pairingId || answer.offerDigest !== this.pendingOffer.digest || answer.toDeviceId !== this.session.publicIdentity.deviceId) {
      throw new Error("应答码不属于当前配对任务");
    }
    if (answer.from.deviceId === this.session.publicIdentity.deviceId) throw new Error("不能与本设备配对");
    if (this.remote && this.remote.deviceId !== answer.from.deviceId) throw new Error("应答设备身份与原设备不符");
    rejectRelayCandidate(answer.sdp.sdp);
    this.remote = answer.from;
    await this.connection.setRemoteDescription(answer.sdp);
    this.pendingOffer = null;
    this.updateStatus();
    return answer.from;
  }

  async send(frame: unknown): Promise<void> {
    const channel = this.channel;
    if (!channel || !this.ready) throw new Error("P2P 连接尚未建立");
    const encoded = JSON.stringify(frame);
    if (encoded.length > 64 * 1024) throw new Error("数据帧超过 64 KiB；附件需分片发送");
    if (channel.bufferedAmount > 512 * 1024) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("发送缓冲区等待超时")), 15_000);
        channel.addEventListener("bufferedamountlow", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    if (channel.readyState !== "open") throw new Error("连接已断开，消息留在本地待发送队列");
    channel.send(encoded);
  }

  async selectedCandidatePair(): Promise<CandidatePairReport | null> {
    const stats = await this.connection.getStats();
    for (const report of stats.values()) {
      const pair = report as RTCStats & { type: string; state?: string; nominated?: boolean; localCandidateId?: string; remoteCandidateId?: string; currentRoundTripTime?: number; bytesSent?: number; bytesReceived?: number };
      if (pair.type !== "candidate-pair" || pair.state !== "succeeded" || !pair.nominated) continue;
      const local = stats.get(pair.localCandidateId ?? "") as (RTCStats & { candidateType?: string; protocol?: string }) | undefined;
      const remote = stats.get(pair.remoteCandidateId ?? "") as (RTCStats & { candidateType?: string; protocol?: string }) | undefined;
      if (local?.candidateType === "relay" || remote?.candidateType === "relay") throw new Error("检测到被禁止的 TURN relay 连接");
      return {
        localType: local?.candidateType ?? "unknown",
        remoteType: remote?.candidateType ?? "unknown",
        protocol: local?.protocol ?? remote?.protocol ?? "unknown",
        rttMs: typeof pair.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1000) : null,
        bytesSent: pair.bytesSent ?? 0,
        bytesReceived: pair.bytesReceived ?? 0,
      };
    }
    return null;
  }

  close(): void {
    this.channel?.close();
    this.connection.close();
    this.setStatus("disconnected");
  }
}
