// The audio master: one gain for every sound Maestrale plays — Sound Player
// tracks and timeline audio. Set by Audio Level widgets in OUT mode (through
// MasterEngine, across pages); 1 when there is none.

let gain = 1;
const listeners = new Set<(g: number) => void>();
const nodes = new Map<BaseAudioContext, GainNode>();

export function getAudioMaster(): number { return gain; }

export function setAudioMaster(g: number): void {
  const v = Math.max(0, Math.min(1, g));
  if (v === gain) return;
  gain = v;
  for (const [ctx, node] of nodes) {
    if ((ctx as AudioContext).state === 'closed') { nodes.delete(ctx); continue; }
    node.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
  }
  listeners.forEach((f) => f(v));
}

export function onAudioMaster(fn: (g: number) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// Web Audio graphs connect here instead of ctx.destination.
export function masterOut(ctx: AudioContext): AudioNode {
  let n = nodes.get(ctx);
  if (!n) {
    n = ctx.createGain();
    n.gain.value = gain;
    n.connect(ctx.destination);
    nodes.set(ctx, n);
  }
  return n;
}
