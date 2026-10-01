export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Seeded random helpers. Each game makes its own so one game's generation never shifts another's.
export function createRng(seed) {
  const rand = mulberry32(typeof seed === 'number' ? seed : hashString(String(seed)));
  const rr = (a, b) => a + rand() * (b - a);
  return {
    rand,
    rr,
    ri: (a, b) => Math.floor(rr(a, b + 1)),
    pick: (arr) => arr[Math.floor(rand() * arr.length)],
  };
}
