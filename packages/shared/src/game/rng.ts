// Small deterministic PRNG (mulberry32) so games are reproducible from a seed.

export type RngState = { seed: number };

export function nextRandom(state: RngState): number {
  state.seed = (state.seed + 0x6d2b79f5) | 0;
  let t = state.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(state: RngState, maxExclusive: number): number {
  return Math.floor(nextRandom(state) * maxExclusive);
}

export function shuffleInPlace<T>(state: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(state, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) | 0;
}
