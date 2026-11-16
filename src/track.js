// Track maths. The centreline is a pure function of distance `s` (metres),
// so no track data is stored anywhere: x = cx(s), y = cy(s), z = -s.

export const ZONE_LEN = 1800;
export const LENGTH = ZONE_LEN * 4;
export const KERB_HALF = 8;   // asphalt + kerb, metres from the centreline
export const WALL = 11.5;     // barrier
export const ZONE_NAMES = ['NEO CITY', 'SAKURA FOREST', 'FUJI PASS', 'TOTTORI DUNES'];

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Zones: 0 city, 1 forest, 2 mountain, 3 desert. Returns [zone, nextZone, blend]
// where blend rises 0 -> 1 over the last 240 m of a zone.
const BLEND = 240;
export function zoneBlend(s) {
  const zf = clamp(s / ZONE_LEN, 0, 3.9999);
  const i = Math.floor(zf);
  return [i, Math.min(3, i + 1), i < 3 ? smooth(1 - BLEND / ZONE_LEN, 1, zf - i) : 0];
}
const zmix = (s, v) => {
  const [i, j, t] = zoneBlend(s);
  return v[i] + (v[j] - v[i]) * t;
};

const CURVE = [0.55, 1.0, 1.15, 0.85]; // how twisty each zone is
const HILL = [0.15, 0.8, 1.5, 0.9];    // how hilly each zone is

export function cx(s) {
  const wave = 55 * Math.sin(s / 300) + 30 * Math.sin(s / 131 + 1.3) + 12 * Math.sin(s / 67 + 4);
  return smooth(120, 500, s) * zmix(s, CURVE) * wave; // dead straight around the start grid
}

export function cy(s) {
  const climb = 45 * smooth(ZONE_LEN * 2 - 100, ZONE_LEN * 2 + 500, s) * (1 - smooth(ZONE_LEN * 3 - 500, ZONE_LEN * 3 + 100, s));
  return zmix(s, HILL) * (6 * Math.sin(s / 210) + 3 * Math.sin(s / 90 + 2)) + climb;
}

export const dcx = (s) => (cx(s + 1) - cx(s - 1)) / 2;
export const dcy = (s) => (cy(s + 1) - cy(s - 1)) / 2;
export const curv = (s) => (cx(s + 4) - 2 * cx(s) + cx(s - 4)) / 16;

// Height of the land beside the road, per zone. `d` is distance beyond the verge.
function sideH(z, s, off, d) {
  if (z === 0) return 0;
  const e = smooth(6, 50, d);
  const f = Math.max(0, d - 6);
  if (z === 1) return e * (3 + 4 * Math.sin(s / 83 + off / 37) + 3 * Math.sin(off / 19 - s / 51)) + f * 0.06;
  if (z === 2) {
    const g = Math.max(0, d - 14);
    const slope = (0.5 + 0.22 * Math.sin(s / 97 + (off > 0 ? 1.7 : 0))) * (0.75 + 0.25 * Math.sin(off / 45 + s / 130));
    return g * slope + smooth(14, 60, d) * 16 * Math.abs(Math.sin(s / 43 + off / 31));
  }
  return e * (4 + 6 * Math.sin(s / 110 + off / 55) + 3 * Math.sin(off / 23 - s / 61)) + f * 0.02;
}

export function terrainH(s, off) {
  const base = cy(s);
  const d = Math.abs(off) - 12;
  if (d <= 0) return base;
  const [i, j, t] = zoneBlend(s);
  const a = sideH(i, s, off, d);
  return base + (t > 0 ? a + (sideH(j, s, off, d) - a) * t : a);
}
