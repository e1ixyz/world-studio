// World layout. 1 unit = 1 meter.
export const BLOCKS = 19; // blocks per side
export const BLOCK = 64; // block size (curb to curb)
export const ROAD = 16; // road width
export const SIDEWALK = 4;
export const CURB = 0.2;
export const PERIOD = BLOCK + ROAD;
export const HALF = (BLOCKS * PERIOD) / 2;
export const CITY_EDGE = HALF + ROAD / 2;
export const PROMENADE = 26;
export const WORLD_LIMIT = CITY_EDGE + PROMENADE - 1.2;
export const LANE = 1.8; // travel lane offset from road center
export const PARK_LANE = 5.7; // parking lane offset

export const roadC = (i) => -HALF + i * PERIOD;
export const blockMin = (i) => roadC(i) + ROAD / 2;
export const mod = (a, n) => ((a % n) + n) % n;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
