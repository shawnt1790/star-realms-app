// Sound effects, synthesized with the Web Audio API: no audio files to ship or license.
// Browsers keep audio locked until the page gets a click or key press, so the
// context is created and resumed on the first one; sounds before that are dropped.

export type SoundName =
  | "turn"
  | "choice"
  | "hit"
  | "baseLost"
  | "buy"
  | "attack"
  | "baseDestroyed"
  | "eliminated"
  | "victory"
  | "defeat";

/** Sounds that end or reshape the game; minor sounds right after them are skipped. */
const MAJOR = new Set<SoundName>(["eliminated", "victory", "defeat"]);
const MAJOR_QUIET_MS = 600;
const MASTER_VOLUME = 0.5;
const MUTE_KEY = "sr_muted";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lastMajorAt = 0;

let muted = readMuted();
const listeners = new Set<() => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // Remembering the choice is a convenience only.
  }
  for (const l of listeners) l();
}

export function subscribeMuted(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function unlock() {
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
}

export function playSound(name: SoundName) {
  const ac = ctx;
  const out = master;
  if (muted || !ac || !out) return;
  const now = performance.now();
  if (MAJOR.has(name)) lastMajorAt = now;
  else if (now - lastMajorAt < MAJOR_QUIET_MS) return;
  const start = () => RECIPES[name](ac, out, ac.currentTime + 0.01);
  if (ac.state === "running") return start();
  // Browsers may suspend audio in a background tab; once the page has had a click,
  // resuming doesn't need another one.
  ac.resume().then(
    () => {
      if (ac.state === "running") start();
    },
    () => {},
  );
}

// ---------------------------------------------------------------- building blocks

type Wave = OscillatorType;

/** One enveloped oscillator note, optionally sliding to `toFreq`. */
function tone(
  ac: AudioContext,
  out: AudioNode,
  t: number,
  freq: number,
  dur: number,
  opts: { wave?: Wave; gain?: number; toFreq?: number; attack?: number } = {},
) {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = opts.wave ?? "sine";
  osc.frequency.setValueAtTime(freq, t);
  if (opts.toFreq) osc.frequency.exponentialRampToValueAtTime(opts.toFreq, t + dur);
  const peak = opts.gain ?? 0.25;
  const attack = opts.attack ?? 0.01;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** A burst of filtered noise: impacts and explosions. */
function noise(
  ac: AudioContext,
  out: AudioNode,
  t: number,
  dur: number,
  opts: { gain?: number; from?: number; to?: number } = {},
) {
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(opts.from ?? 3000, t);
  filter.frequency.exponentialRampToValueAtTime(opts.to ?? 200, t + dur);
  const env = ac.createGain();
  env.gain.setValueAtTime(opts.gain ?? 0.3, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(env).connect(out);
  src.start(t);
}

// Note frequencies (Hz).
const C4 = 261.63,
  E4 = 329.63,
  G4 = 392.0,
  A3 = 220.0,
  E3 = 164.81,
  F3 = 174.61,
  C5 = 523.25,
  E5 = 659.25,
  G5 = 783.99,
  A5 = 880.0,
  B5 = 987.77,
  C6 = 1046.5,
  E6 = 1318.51;

type Recipe = (ac: AudioContext, out: AudioNode, t: number) => void;

const RECIPES: Record<SoundName, Recipe> = {
  // Your turn: a soft rising two-note chime.
  turn: (ac, out, t) => {
    tone(ac, out, t, E5, 0.35, { gain: 0.2 });
    tone(ac, out, t + 0.12, A5, 0.5, { gain: 0.2 });
  },
  // Your input is needed on someone else's turn: two quick pings.
  choice: (ac, out, t) => {
    tone(ac, out, t, A5, 0.15, { wave: "triangle", gain: 0.22 });
    tone(ac, out, t + 0.18, A5, 0.2, { wave: "triangle", gain: 0.22 });
  },
  // You took damage: a low thud.
  hit: (ac, out, t) => {
    tone(ac, out, t, 140, 0.3, { toFreq: 50, gain: 0.45 });
    noise(ac, out, t, 0.15, { gain: 0.12, from: 1200, to: 150 });
  },
  // Your base was destroyed: a crunch and a falling low tone.
  baseLost: (ac, out, t) => {
    noise(ac, out, t, 0.45, { gain: 0.25, from: 2000, to: 100 });
    tone(ac, out, t, A3, 0.25, { wave: "sawtooth", gain: 0.08 });
    tone(ac, out, t + 0.2, E3, 0.4, { wave: "sawtooth", gain: 0.08 });
  },
  // Bought a card: a coin-like blip.
  buy: (ac, out, t) => {
    tone(ac, out, t, B5, 0.08, { wave: "square", gain: 0.06 });
    tone(ac, out, t + 0.07, E6, 0.2, { wave: "square", gain: 0.06 });
  },
  // Attacked a player: a short laser zap.
  attack: (ac, out, t) => {
    tone(ac, out, t, 1400, 0.18, { wave: "sawtooth", toFreq: 180, gain: 0.08 });
    noise(ac, out, t + 0.05, 0.15, { gain: 0.1, from: 2500, to: 300 });
  },
  // Destroyed an enemy base: a bigger blast.
  baseDestroyed: (ac, out, t) => {
    tone(ac, out, t, 1200, 0.15, { wave: "sawtooth", toFreq: 200, gain: 0.07 });
    noise(ac, out, t + 0.08, 0.6, { gain: 0.3, from: 4000, to: 80 });
    tone(ac, out, t + 0.08, 90, 0.5, { toFreq: 40, gain: 0.35 });
  },
  // Someone was knocked out: a descending three-note figure.
  eliminated: (ac, out, t) => {
    tone(ac, out, t, G4, 0.2, { wave: "triangle", gain: 0.2 });
    tone(ac, out, t + 0.16, E4, 0.2, { wave: "triangle", gain: 0.2 });
    tone(ac, out, t + 0.32, C4, 0.45, { wave: "triangle", gain: 0.2 });
  },
  // You won: a rising arpeggio.
  victory: (ac, out, t) => {
    [C5, E5, G5, C6].forEach((f, i) =>
      tone(ac, out, t + i * 0.12, f, i === 3 ? 0.8 : 0.25, { wave: "triangle", gain: 0.2 }),
    );
  },
  // You lost: a slow falling phrase.
  defeat: (ac, out, t) => {
    [C4, A3, F3].forEach((f, i) =>
      tone(ac, out, t + i * 0.25, f, i === 2 ? 0.9 : 0.35, { gain: 0.22, attack: 0.03 }),
    );
  },
};
