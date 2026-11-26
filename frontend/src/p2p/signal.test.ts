import { expect, it } from "vitest";
import { createVault } from "./crypto";
import { createSignal, decodeSignal, encodeSignal, reassembleSignalParts, signalDigest, splitSignalCode } from "./signal";

it("signs manual WebRTC offer and reassembles out-of-order QR fragments", async () => {
  const device = await createVault("Phone", "correct horse battery staple");
  const pairingId = crypto.randomUUID();
  const signal = createSignal(device.session, {
    kind: "offer", pairingId,
    description: { type: "offer", sdp: `v=0\n${"a=candidate:1 1 UDP 123 192.0.2.1 5000 typ host\n".repeat(100)}` },
  });
  const code = encodeSignal(signal);
  expect((await decodeSignal(code)).from.deviceId).toBe(device.record.publicIdentity.deviceId);
  expect((await signalDigest(code)).length).toBe(24);
  const parts = await splitSignalCode(code, pairingId, 480);
  expect(parts.length).toBeGreaterThan(1);
  const partial = await reassembleSignalParts(parts.slice(1));
  expect(partial.complete).toBe(false);
  const complete = await reassembleSignalParts([...parts].reverse());
  expect(complete.code).toBe(code);
  await expect(reassembleSignalParts([parts[0], parts[0].replace(/.$/, "x")])).rejects.toThrow("冲突");
  device.session.lock();
});
