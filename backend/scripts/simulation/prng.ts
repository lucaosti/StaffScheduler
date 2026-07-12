/**
 * Deterministic, seedable pseudo-random number generator (mulberry32).
 *
 * No AI, no wall-clock randomness: every "random" decision the simulation
 * makes — which request type an employee files, which assignment/org unit
 * it targets, whether a manager approves or delegates — is derived from this
 * generator, seeded once at the top of the run and logged so the whole run
 * is bit-for-bit reproducible from `--seed`.
 *
 * @author Luca Ostinelli
 */

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p` (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Picks one element deterministically. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)];
  }

  /** Derives an independent child Rng, deterministic given (seed, key). */
  child(key: number | string): Rng {
    const s = typeof key === 'number' ? key : hashString(key);
    return new Rng((this.state ^ s ^ 0x9e3779b9) >>> 0);
  }
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}
