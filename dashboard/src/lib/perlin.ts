/**
 * Lightweight 2D Perlin noise — classic permutation-table approach.
 * No dependencies. Deterministic: same (x, y) → same output in [-1, 1].
 */

const PERM = buildPermutation();

function buildPermutation(): Uint8Array {
  const p = new Uint8Array(512);
  // Fisher-Yates on 0..255 with fixed seed
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
}

// 2D gradient vectors (8 directions)
const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

function dot2(gi: number, x: number, y: number): number {
  const g = GRAD[gi & 7];
  return g[0] * x + g[1] * y;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/** Returns Perlin noise value in [-1, 1] for given 2D coordinates. */
export function perlin2D(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);

  const u = fade(xf);
  const v = fade(yf);

  const aa = PERM[PERM[xi] + yi];
  const ab = PERM[PERM[xi] + yi + 1];
  const ba = PERM[PERM[xi + 1] + yi];
  const bb = PERM[PERM[xi + 1] + yi + 1];

  return lerp(
    lerp(dot2(aa, xf, yf), dot2(ba, xf - 1, yf), u),
    lerp(dot2(ab, xf, yf - 1), dot2(bb, xf - 1, yf - 1), u),
    v,
  );
}
