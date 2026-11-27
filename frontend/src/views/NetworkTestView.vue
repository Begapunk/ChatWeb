<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getActiveEngine } from "../p2p/active";

interface Result { url: string; elapsedMs: number; host: number; srflx: number; ipv4: number; ipv6: number; error?: string }
interface LivePeer { id: string; name: string; ice: string; channel: string; auth: string; localType: string; remoteType: string; protocol: string; rttMs: number | null; direct: boolean; lastConnectedAt: number | null; reconnectCount: number; lastFailure: string | null }
const carrier = ref("未填写");
const connection = ref("未知");
const stunText = ref("stun:stun.l.google.com:19302\nstun:stun1.l.google.com:19302");
const results = ref<Result[]>([]);
const livePeers = ref<LivePeer[]>([]);
const running = ref(false);
const error = ref("");
const browser = navigator.userAgent;
const webrtcSupported = typeof RTCPeerConnection !== "undefined";
let active: RTCPeerConnection | null = null;
let liveTimer = 0;

async function refreshLive(): Promise<void> {
  const engine = getActiveEngine();
  if (!engine) { livePeers.value = []; return; }
  livePeers.value = await Promise.all([...engine.links.entries()].map(async ([id, link]) => {
    const history = engine.historyFor(id);
    let pair = null;
    let failure = history?.lastFailure ?? null;
    if (link.ready) {
      try { pair = await link.selectedCandidatePair(); }
      catch (reason) { failure = reason instanceof Error ? reason.message : String(reason); }
    }
    return { id, name: link.remoteIdentity?.name ?? id, ice: link.connection.iceConnectionState,
      channel: link.ready ? "open" : "closed/disconnected", auth: engine.authFor(id)?.trusted ? "已验证并信任" : engine.authFor(id)?.failed ? "认证失败" : "当前会话未认证",
      localType: pair?.localType ?? "无当前候选", remoteType: pair?.remoteType ?? "无当前候选", protocol: pair?.protocol ?? "未知", rttMs: pair?.rttMs ?? null,
      direct: Boolean(link.ready && pair && pair.localType !== "relay" && pair.remoteType !== "relay"),
      lastConnectedAt: history?.lastConnectedAt ?? null, reconnectCount: history?.reconnectCount ?? 0, lastFailure: failure };
  }));
}

async function probe(url: string): Promise<Result> {
  const started = performance.now();
  const result: Result = { url, elapsedMs: 0, host: 0, srflx: 0, ipv4: 0, ipv6: 0 };
  if (!/^stuns?:[^\s]+$/i.test(url) || /turn/i.test(url)) throw new Error("仅允许 STUN 地址，禁止 TURN");
  const peer = new RTCPeerConnection({ iceServers: [{ urls: url }], iceTransportPolicy: "all" });
  active = peer;
  peer.createDataChannel("diagnostic");
  peer.onicecandidate = (event) => {
    const raw = event.candidate?.candidate;
    if (!raw) return;
    if (/\btyp host\b/.test(raw)) result.host++;
    if (/\btyp srflx\b/.test(raw)) result.srflx++;
    if (/\s[0-9a-f:]+\s\d+\s+typ\s/i.test(raw)) result.ipv6++; else result.ipv4++;
  };
  try {
    await peer.setLocalDescription(await peer.createOffer());
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 9000);
      peer.addEventListener("icegatheringstatechange", () => { if (peer.iceGatheringState === "complete") { window.clearTimeout(timer); resolve(); } });
    });
    result.elapsedMs = Math.round(performance.now() - started);
    if (!result.srflx) result.error = "未取得 srflx 候选；可能受网络限制";
    return result;
  } finally { peer.close(); active = null; }
}

async function test(): Promise<void> {
  if (running.value) return;
  running.value = true; error.value = ""; results.value = [];
  try {
    if (typeof RTCPeerConnection === "undefined") throw new Error("此浏览器不支持 WebRTC");
    const urls = stunText.value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
    if (!urls.length || urls.length > 8) throw new Error("请输入 1 至 8 个 STUN 地址");
    for (const url of urls) {
      try { results.value.push(await probe(url)); }
      catch (reason) { results.value.push({ url, elapsedMs: 0, host: 0, srflx: 0, ipv4: 0, ipv6: 0, error: reason instanceof Error ? reason.message : String(reason) }); }
    }
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { running.value = false; }
}

function exportReport(): void {
  const report = { generatedAt: new Date().toISOString(), source: "本机浏览器诊断", carrier: carrier.value, connection: connection.value,
    browser, webrtcSupported: typeof RTCPeerConnection !== "undefined", stun: results.value,
    livePeers: livePeers.value, note: "仅报告本机当前连接或明确标注的历史时间；未进行真实运营商间连通性验证；诊断报告不含 IP 地址" };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = "aether-network-report.json"; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
onMounted(() => { void refreshLive(); liveTimer = window.setInterval(() => { void refreshLive(); }, 2000); });
onBeforeUnmount(() => { active?.close(); window.clearInterval(liveTimer); });
</script>

<template>
  <section class="diagnostic">
    <RouterLink to="/">← 返回聊天</RouterLink><h1>网络诊断</h1>
    <p>检测本机 WebRTC 候选地址类型。测试不发送聊天数据，也不会验证两台设备能否连通。</p>
    <div class="card"><h2>当前设备</h2><p>浏览器：{{ browser }}</p><p>WebRTC：{{ webrtcSupported ? '支持' : '不支持' }}</p></div>
    <div class="card"><h2>当前 P2P 连接</h2><p v-if="!livePeers.length" class="muted">当前没有已解锁并连接的设备；下面的 STUN 测试只检查本机候选。</p><article v-for="peer in livePeers" :key="peer.id"><strong>{{ peer.name }}</strong><p>ICE：{{ peer.ice }} · DataChannel：{{ peer.channel }} · 身份：{{ peer.auth }}</p><p>当前路径：{{ peer.direct ? `${peer.localType} ↔ ${peer.remoteType} · ${peer.protocol}` : '当前无已验证的直连路径' }} · RTT：{{ peer.rttMs === null ? '未知' : `${peer.rttMs} ms` }}</p><p>最近成功连接（历史）：{{ peer.lastConnectedAt ? new Date(peer.lastConnectedAt).toLocaleString() : '无记录' }} · 本次解锁后的重连次数：{{ peer.reconnectCount }}</p><p v-if="peer.lastFailure" class="muted">最近失败：{{ peer.lastFailure }}</p></article></div>
    <div class="card"><h2>网络标签（手动填写）</h2><label>运营商或网络<select v-model="carrier"><option>未填写</option><option>中国移动</option><option>中国电信</option><option>中国联通</option><option>中国广电</option><option>Wi-Fi</option><option>校园网</option><option>公司网络</option><option>其他网络</option></select></label><label>连接方式<select v-model="connection"><option>未知</option><option>Wi-Fi</option><option>4G</option><option>5G</option><option>VPN 开启</option><option>VPN 关闭</option></select></label><p class="muted">浏览器无法可靠识别运营商和 VPN 状态。</p></div>
    <div class="card"><h2>STUN 节点</h2><textarea v-model="stunText" rows="3" aria-label="STUN 地址，每行一个"></textarea><p class="muted">默认地址仅供尝试，未验证在中国大陆各运营商的可靠性。不会使用 TURN。</p><button :disabled="running" @click="test">{{ running ? '检测中…' : '开始检测' }}</button><button @click="exportReport">导出本地报告</button><p v-if="error" role="alert">{{ error }}</p><article v-for="item in results" :key="item.url"><strong>{{ item.url }}</strong><p>耗时 {{ item.elapsedMs }} ms · host {{ item.host }} · srflx {{ item.srflx }} · IPv4 {{ item.ipv4 }} · IPv6 {{ item.ipv6 }}</p><p v-if="item.error" class="muted">{{ item.error }}</p></article></div>
    <p class="muted">实际候选路径、RTT 和连接质量需要与另一台真实设备建立连接后才能测量。CGNAT、对称 NAT 或 UDP 受限网络可能无法使用无中继 P2P。</p>
  </section>
</template>

<style scoped>
.diagnostic{max-width:820px;width:100%;box-sizing:border-box;margin:auto;padding:24px 16px 80px;color:var(--ae-text)}.diagnostic a{color:var(--ae-accent)}.diagnostic h1{font-size:26px}.diagnostic h2{font-size:17px}.card{border:1px solid var(--ae-border);background:var(--ae-bg-elev);padding:16px;margin:16px 0;border-radius:var(--ae-radius)}.card article{border-top:1px solid var(--ae-border);margin-top:12px;padding-top:12px}.card label{display:block;margin:12px 0}.card select,.card textarea{display:block;width:100%;box-sizing:border-box;margin:8px 0;background:var(--ae-bg-elev-2);color:var(--ae-text);border:1px solid var(--ae-border);border-radius:10px;padding:10px;font:inherit}.card button{background:var(--ae-accent-soft);color:var(--ae-text);border:1px solid var(--ae-border-strong);border-radius:10px;padding:10px;margin-right:8px;cursor:pointer}.muted{color:var(--ae-text-muted);font-size:12px;line-height:1.5}
</style>
