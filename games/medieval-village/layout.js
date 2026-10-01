import * as THREE from 'three';
import { smoothstep, lerp } from '../../engine/index.js';

// City plan: three hills on the north shore of Blackwater Bay, a curtain wall with six gates,
// and the main streets between them. x is east, z is south (the bay is +z).

export const HILLS = {
  aegon: { x: 175, z: 105, p: 58, r: 125, h: 26 }, // Aegon's High Hill: the Red Keep
  visenya: { x: -170, z: -60, p: 48, r: 115, h: 18 }, // Visenya's Hill: the Great Sept
  rhaenys: { x: 40, z: -210, p: 55, r: 110, h: 15 }, // Rhaenys's Hill: the Dragonpit
};

export const RIVER_W = 34;
export const riverX = (z) => -440 + 25 * Math.sin(z / 140);
export const shoreZ = (x) => 212 + 9 * Math.sin(x / 83) + 5 * Math.sin(x / 31 + 1.3) + 22 * Math.exp(-(((x - 190) / 70) ** 2));

// Raw terrain height (goes below the water in the bay and river).
export function terrainY(x, z) {
  let hillK = 0, hills = 0;
  for (const k in HILLS) {
    const h = HILLS[k];
    const d = Math.hypot(x - h.x, z - h.z);
    if (d < h.r) {
      const s = smoothstep(h.r, h.p, d);
      hills += h.h * s;
      if (s > hillK) hillK = s;
    }
  }
  let y = 3 + (1.2 * Math.sin(x / 53 + 0.7) * Math.cos(z / 61) + 0.6 * Math.sin(x / 19) * Math.sin(z / 23)) * (1 - hillK) + hills;
  const r = Math.hypot(x, z);
  if (r > 420) y += smoothstep(420, 900, r) * (6 + 5 * Math.sin(x / 230) * Math.cos(z / 190) + 3 * Math.sin(x / 97 + z / 131));
  const dr = Math.abs(x - riverX(z));
  if (dr < RIVER_W + 18) y = lerp(-5, y, smoothstep(RIVER_W - 8, RIVER_W + 18, dr));
  const s = z - shoreZ(x);
  if (s > -22) y = lerp(y, -8, smoothstep(-22, 40, s));
  return y;
}

// What the player stands on: wade into the shallows, never walk the sea floor.
export const groundY = (x, z) => Math.max(terrainY(x, z), -1.1);

// ---------- walls and gates ----------
export const WALL = [
  [-300, 180], [-318, 40], [-292, -140], [-205, -270], [-60, -332], [110, -322], [250, -232],
  [322, -80], [334, 60], [300, 170], [230, 182], [100, 178], [-30, 178], [-160, 181],
];

const GATE_DEFS = [
  { name: 'River Gate', seg: 0, t: 0.35 },
  { name: 'Old Gate', seg: 2, t: 0.5 },
  { name: "King's Gate", seg: 4, t: 0.38 },
  { name: 'Lion Gate', seg: 6, t: 0.5 },
  { name: 'Gate of the Gods', seg: 7, t: 0.45 },
  { name: 'Mud Gate', seg: 12, t: 0.3 },
];
export const GATE_HALF = 14; // wall gap either side of a gate center (gate towers fill 5..14)

export const GATES = GATE_DEFS.map((g) => {
  const [ax, az] = WALL[g.seg], [bx, bz] = WALL[(g.seg + 1) % WALL.length];
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const x = ax + (bx - ax) * g.t, z = az + (bz - az) * g.t;
  let nx = dz, nz = -dx;
  if (nx * (x - 0) + nz * (z + 50) < 0) (nx = -nx), (nz = -nz); // point away from the city center
  return { ...g, x, z, dx, dz, nx, nz, along: len * g.t };
});
const gate = (name) => GATES.find((g) => g.name === name);
const out = (name, d) => { const g = gate(name); return [g.x + g.nx * d, g.z + g.nz * d]; };
const at = (name) => { const g = gate(name); return [g.x, g.z]; };

export function insideWalls(x, z) {
  let c = false;
  for (let i = 0, j = WALL.length - 1; i < WALL.length; j = i++) {
    const [xi, zi] = WALL[i], [xj, zj] = WALL[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
export function distToWall(x, z) {
  let d = 1e9;
  for (let i = 0; i < WALL.length; i++) {
    const [ax, az] = WALL[i], [bx, bz] = WALL[(i + 1) % WALL.length];
    d = Math.min(d, segDist(x, z, ax, az, bx, bz));
  }
  return d;
}

// ---------- landmarks and squares ----------
export const KEEP = { x: 175, z: 105, half: 50, gate: [175, 42] };
export const SEPT = { x: -170, z: -60 };
export const PIT = { x: 40, z: -210, r: 47 };
export const PLAZA = { name: "Cobbler's Square", x: -10, z: -50, r: 30 };
export const FISH = { name: "Fishmonger's Square", x: -62, z: 142, r: 17 };
export const FLEA = { x: -110, z: 60, r: 80 };
export const PIERS = [-250, -185, -120, -10, 60];

// ---------- streets ----------
const ROAD_DEFS = [
  { name: 'the Kingsroad', w: 9, pts: [out("King's Gate", 900), out("King's Gate", 250), out("King's Gate", 0)] },
  { name: 'Street of the Sisters', w: 8, pts: [at("King's Gate"), [5, -270], [-5, -160], [-10, -78]] },
  { name: 'the Roseroad', w: 8, pts: [out('Old Gate', 700), out('Old Gate', 200), out('Old Gate', 0)] },
  { name: 'Street of Flour', w: 7, pts: [at('Old Gate'), [-190, -172], [-115, -115], [-38, -60]] },
  { name: 'Lion Road', w: 8, pts: [out('Lion Gate', 0), out('Lion Gate', 250), out('Lion Gate', 700)] },
  { name: 'Street of Steel', w: 8, pts: [at('Lion Gate'), [210, -130], [100, -80], [18, -56]] },
  { name: 'Kingswood Road', w: 7, pts: [out('Gate of the Gods', 0), out('Gate of the Gods', 300), out('Gate of the Gods', 800)] },
  { name: "Gods' Way", w: 7, pts: [at('Gate of the Gods'), [240, -5], [200, 22], KEEP.gate] },
  { name: "Aegon's High Road", w: 9, pts: [[18, -40], [70, -10], [130, 18], KEEP.gate] },
  { name: 'the Hook', w: 6, pts: [[-46, 138], [40, 118], [100, 82], [140, 44], KEEP.gate] },
  { name: 'Mud Gate Road', w: 7, pts: [out('Mud Gate', 22), at('Mud Gate'), [FISH.x, FISH.z], [-40, 60], [-18, -22]] },
  { name: 'River Row', w: 7, pts: [out('River Gate', 110), out('River Gate', 0), [-230, 125], [-150, 120], [-78, 138]] },
  { name: 'Sept Approach', w: 10, pts: [[-38, -54], [-90, -60], [-124, -60]] },
  { name: 'Dragonpit Stair', w: 6, pts: [[-6, -128], [22, -148], [40, -160]] },
  { name: 'Pig Alley', w: 5, pts: [[-150, 120], [-120, 60], [-60, 10], [-38, -40]] },
];

export const ROADS = ROAD_DEFS.map((r) => {
  const curve = new THREE.CatmullRomCurve3(r.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const len = curve.getLength();
  const n = Math.max(2, Math.ceil(len / 2));
  const pts = curve.getSpacedPoints(n).map((p) => [p.x, p.z]);
  return { ...r, pts, len, step: len / n };
});

// spatial hash of road samples for clearance queries
const RC = 16;
const roadHash = new Map();
for (const r of ROADS) {
  for (const [x, z] of r.pts) {
    const k = `${Math.floor(x / RC)},${Math.floor(z / RC)}`;
    let a = roadHash.get(k);
    if (!a) roadHash.set(k, (a = []));
    a.push(x, z, r.w / 2);
  }
}
// Distance from (x, z) to the nearest road edge (negative inside a road), up to `max`.
export function roadClear(x, z, max = 24) {
  let best = max;
  const c0 = Math.floor((x - max) / RC), c1 = Math.floor((x + max) / RC);
  const d0 = Math.floor((z - max) / RC), d1 = Math.floor((z + max) / RC);
  for (let i = c0; i <= c1; i++) {
    for (let j = d0; j <= d1; j++) {
      const a = roadHash.get(`${i},${j}`);
      if (!a) continue;
      for (let k = 0; k < a.length; k += 3) {
        const d = Math.hypot(x - a[k], z - a[k + 1]) - a[k + 2];
        if (d < best) best = d;
      }
    }
  }
  return best;
}

// Named districts, checked in order (first match wins).
export function districtAt(x, z) {
  if (Math.abs(x - KEEP.x) < KEEP.half + 4 && Math.abs(z - KEEP.z) < KEEP.half + 4) return 'The Red Keep';
  if (Math.hypot(x - SEPT.x, z - SEPT.z) < 62) return 'Great Sept of Baelor';
  if (Math.hypot(x - PIT.x, z - PIT.z) < 60) return 'The Dragonpit';
  if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 4) return PLAZA.name;
  if (Math.hypot(x - FISH.x, z - FISH.z) < FISH.r + 4) return FISH.name;
  for (const g of GATES) if (Math.hypot(x - g.x, z - g.z) < 22) return g.name;
  const inside = insideWalls(x, z);
  if (!inside && z > 176 && z < shoreZ(x) + 110 && x > -320 && x < 120) return 'Blackwater Docks';
  if (inside && Math.hypot(x - FLEA.x, z - FLEA.z) < FLEA.r) return 'Flea Bottom';
  if (!inside && Math.abs(x - riverX(z)) < RIVER_W + 10) return 'Blackwater Rush';
  if (!inside && terrainY(x, z) < -1) return 'Blackwater Bay';
  return inside ? "King's Landing" : 'Outside the walls';
}
