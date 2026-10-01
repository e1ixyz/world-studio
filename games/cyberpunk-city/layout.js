import { mulberry32, createRng, smoothstep, lerp } from '../../engine/index.js';

// Hong Kong-style layout: Victoria Harbour to the north (−z), a flat reclaimed waterfront,
// then the mountain rising to the south (+z) with towers terraced into its slopes.
// Kowloon sits across the harbour as a distant skyline.
export const LAND_Y = 2.5;
export const SHORE_Z = -232; // island seawall
export const KOWLOON_Z = -880; // far shore
export const FOOT_Z = -40; // mountain starts rising here
export const CELL = 48; // city grid: 36 m lots with 12 m streets centred on cell edges
export const STREET = 12;
export const GX0 = -768;
export const GZ0 = -212;
export const NI = 32;
export const NJ = 15;
export const FADE = 5.5; // width of the retaining slope around a terraced lot (< STREET / 2)
export const HILL_MAX = 245; // no towers above this elevation, just jungle
export const TRAM_X = 96; // the Peak Tram runs up this street
export const TRAM_Z0 = -58;
export const TRAM_Z1 = 572;
export const PEAK = { x: 96, z: 610, r: 46 };
export const PIER = { x0: -214, x1: -186, z0: -330, z1: SHORE_Z + 2 };
export const MEGA = { i: 16, j: 0 }; // lot reserved for Nexus Tower

function valueNoise(seed) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = rnd();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const at = (x, y) => vals[perm[(perm[x & 255] + y) & 511]];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
  };
}
const nA = valueNoise(11), nB = valueNoise(12), nC = valueNoise(13);
export function fbm(x, z, oct = 4, n = nB) {
  let s = 0, a = 1, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += n(x * f, z * f) * a;
    norm += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / norm;
}

// Height of the mountain above the waterfront, before any terracing.
function mountain(x, z) {
  const u = z - FOOT_Z;
  if (u <= 0) return 0;
  const P = 190 + 150 * Math.exp(-(((x + 150) / 280) ** 2)) + 100 * Math.exp(-(((x - 500) / 230) ** 2)) + 30 * fbm(x / 400, 0.5, 3, nA);
  const rise = smoothstep(0, 720, u);
  const back = 1 - 0.7 * smoothstep(760, 1500, u);
  const gullies = fbm(x / 160, z / 160, 4) * 30 * Math.min(1, rise * 4);
  return Math.max(0, P * rise * back + gullies);
}

// Natural ground: harbour floor, both shores, the island mountain and the Kowloon hills.
export function natural(x, z) {
  if (z >= SHORE_Z) return LAND_Y + mountain(x, z);
  if (z > KOWLOON_Z) return LAND_Y - 11.5 * smoothstep(0, 14, Math.min(SHORE_Z - z, z - KOWLOON_Z));
  const hills = 460 * smoothstep(-1500, -2300, z) * (0.6 + 0.4 * fbm(x / 500, z / 500, 3, nC));
  return LAND_Y + Math.max(0, hills);
}

// ---------- city lots ----------
const R = createRng('hk-lots-v1');
export const lots = [];
for (let j = 0; j < NJ; j++) {
  for (let i = 0; i < NI; i++) {
    const x0 = GX0 + i * CELL + STREET / 2, z0 = GZ0 + j * CELL + STREET / 2;
    const x1 = x0 + CELL - STREET, z1 = z0 + CELL - STREET;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const nat = natural(cx, cz);
    const L = { i, j, x0, x1, z0, z1, cx, cz, nat, zone: 'none', pad: false, padY: nat, built: false };
    const edge = Math.max(0, Math.abs(cx) - 600) / 170; // city thins out toward the ends of the island
    if (cz < FOOT_Z + 10) {
      L.zone = 'downtown';
      L.pad = true;
      L.padY = LAND_Y;
      L.built = R.rand() > edge * 0.8;
    } else if (nat < HILL_MAX && Math.hypot(cx - PEAK.x, cz - PEAK.z) > PEAK.r + 30) {
      L.zone = 'hill';
      const density = lerp(0.95, 0.2, nat / HILL_MAX) * (1 - edge * 0.7);
      L.built = R.rand() < density;
      L.pad = L.built && R.rand() < 0.65; // terraced pad, otherwise the tower is sunk into the slope
      L.padY = Math.round(nat);
    }
    lots.push(L);
  }
}
export const lotAt = (i, j) => (i >= 0 && i < NI && j >= 0 && j < NJ ? lots[j * NI + i] : null);
export const PEAK_Y = Math.round(natural(PEAK.x, PEAK.z));

// Ground with terraces and the Peak plaza cut in.
export function terrainY(x, z) {
  let y = natural(x, z);
  const L = lotAt(Math.floor((x - GX0) / CELL), Math.floor((z - GZ0) / CELL));
  if (L && L.pad) {
    const dx = Math.max(L.x0 - x, 0, x - L.x1), dz = Math.max(L.z0 - z, 0, z - L.z1);
    if (dx < FADE && dz < FADE) y = lerp(y, L.padY, 1 - smoothstep(0, FADE, Math.hypot(dx, dz)));
  }
  const dp = Math.hypot(x - PEAK.x, z - PEAK.z);
  if (dp < PEAK.r + 14) y = lerp(y, PEAK_Y, 1 - smoothstep(PEAK.r, PEAK.r + 14, dp));
  return y;
}

// The player wades rather than sinking to the harbour floor.
export const groundY = (x, z) => Math.max(terrainY(x, z), -1);

// Which part of the city a point is in, for the HUD.
export function districtAt(x, z, y) {
  if (Math.hypot(x - PEAK.x, z - PEAK.z) < PEAK.r + 40) return 'The Peak';
  if (z < KOWLOON_Z + 10) return 'Kowloon';
  if (z < SHORE_Z) return 'Victoria Harbour';
  if (z < GZ0 + 8) return 'Harbourfront';
  if (z < FOOT_Z + 10) return 'Central';
  const e = (y ?? natural(x, z)) - LAND_Y;
  if (e < 110) return 'Mid-Levels';
  return 'Upper Levels';
}
