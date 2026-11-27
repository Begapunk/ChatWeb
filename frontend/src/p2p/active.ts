import type { P2PEngine } from "./engine";

let current: P2PEngine | null = null;

export function setActiveEngine(engine: P2PEngine | null): void { current = engine; }
export function getActiveEngine(): P2PEngine | null { return current; }
