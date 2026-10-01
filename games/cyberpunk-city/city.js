import * as THREE from 'three';
import { GeoBuilder, createRng } from '../../engine/index.js';
import { FACADE_TW, FACADE_TH, NEON } from './textures.js';
import {
  lots, natural, terrainY, LAND_Y, GX0, GZ0, CELL, NI, FOOT_Z, SHORE_Z, KOWLOON_Z, HILL_MAX, MEGA, PIER,
} from './layout.js';

const rgb = (h) => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
};
const TINTS = {
  hk: ['#ffffff', '#f6e4dc', '#dfece6', '#efe8d4', '#dde2ee', '#f2d8d8', '#e8f0d8'].map(rgb),
  glass: ['#ffffff', '#d4e2f0', '#e2e2ff', '#d8f0ec'].map(rgb),
  cyber: ['#ffffff', '#dcdcff', '#ffe0f0'].map(rgb),
  tenement: ['#ffffff', '#f0e2c8', '#ddd4c2', '#d6dfcc', '#eed8cc'].map(rgb),
};
const WHITE = [1, 1, 1];
const ROOF = rgb('#55565a');
const V_COLORS = NEON; // vertical sign k uses NEON[k % NEON.length] (see textures.js)

// UVs for a cell of each atlas (canvas y grows down, texture v grows up).
const cellUV = (cols, rows, k) => {
  const c = k % cols, r = Math.floor(k / cols) % rows;
  const u0 = c / cols, u1 = (c + 1) / cols, vt = 1 - r / rows, vb = vt - 1 / rows;
  return [u0, vb, u1, vb, u1, vt, u0, vt];
};
const vUV = (k) => cellUV(8, 2, k);
const hUV = (k) => cellUV(2, 8, k);
const adUV = (k) => cellUV(2, 4, k);

// Quad standing on the wall plane, facing (nx, nz), centred at (px, pz).
function quadAt(b, px, pz, nx, nz, hw, y0, y1, uv, col = WHITE) {
  const rx = nz, rz = -nx;
  b.quad([px - rx * hw, y0, pz - rz * hw], [px + rx * hw, y0, pz + rz * hw], [px + rx * hw, y1, pz + rz * hw], [px - rx * hw, y1, pz - rz * hw], nx, 0, nz, uv, col);
}

// The four faces of a box: outward normal, the wall's centre line and its length.
const faces = (x0, x1, z0, z1) => [
  { nx: 0, nz: 1, x: (x0 + x1) / 2, z: z1, len: x1 - x0, ax: 1, az: 0 },
  { nx: 1, nz: 0, x: x1, z: (z0 + z1) / 2, len: z1 - z0, ax: 0, az: 1 },
  { nx: 0, nz: -1, x: (x0 + x1) / 2, z: z0, len: x1 - x0, ax: 1, az: 0 },
  { nx: -1, nz: 0, x: x0, z: (z0 + z1) / 2, len: z1 - z0, ax: 0, az: 1 },
];

export function buildCity(scene, T, grid, ctxTextures) {
  const R = createRng('hk-city-v1');
  const B = { hk: new GeoBuilder(), glass: new GeoBuilder(), cyber: new GeoBuilder(), tenement: new GeoBuilder() };
  const roof = new GeoBuilder();
  const neon = new GeoBuilder();
  const vs = new GeoBuilder(), vsF = new GeoBuilder(), hs = new GeoBuilder(), hsF = new GeoBuilder();
  const ads = new GeoBuilder(), pools = new GeoBuilder();
  const blink = [], lamps = [], lampCol = [];
  const buildings = [];
  const signs = { count: 0 };

  const tintOf = (style) => R.pick(TINTS[style]);
  const addBox = (style, x0, x1, y0, y1, z0, z1, col) =>
    B[style].box(x0, x1, y0, y1, z0, z1, { tw: FACADE_TW, th: FACADE_TH, uo: R.ri(0, 7) / 8, vo: R.ri(0, 7) / 8, col, topBuilder: roof, topCol: ROOF, topScale: 0.12 });
  const neonBox = (x0, x1, y0, y1, z0, z1, hex) => neon.box(x0, x1, y0, y1, z0, z1, { col: rgb(hex) });

  function neonEdges(x0, x1, z0, z1, y0, y1, hex, crown = true) {
    const t = 0.45, o = 0.2;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) neonBox(x - o, x - o + t, y0, y1, z - o, z - o + t, hex);
    if (crown) {
      neonBox(x0 - o, x1 + o, y1 - 0.6, y1, z0 - o, z0 - o + t, hex);
      neonBox(x0 - o, x1 + o, y1 - 0.6, y1, z1 + o - t, z1 + o, hex);
      neonBox(x0 - o, x0 - o + t, y1 - 0.6, y1, z0 - o, z1 + o, hex);
      neonBox(x1 + o - t, x1 + o, y1 - 0.6, y1, z0 - o, z1 + o, hex);
    }
  }

  function rooftop(x0, x1, z0, z1, y) {
    const w = x1 - x0, d = z1 - z0;
    for (let k = R.ri(1, 3); k > 0; k--) {
      const sx = R.rr(2.5, Math.min(7, w * 0.3)), sz = R.rr(2.5, Math.min(7, d * 0.3));
      const cx = R.rr(x0 + sx, x1 - sx), cz = R.rr(z0 + sz, z1 - sz);
      roof.box(cx - sx / 2, cx + sx / 2, y, y + R.rr(2, 4.5), cz - sz / 2, cz + sz / 2, { col: rgb('#6b6c70'), topScale: 0.2 });
    }
    if (R.rand() < 0.5) {
      const ax = R.rr(x0 + 2, x1 - 2), az = R.rr(z0 + 2, z1 - 2), ah = R.rr(8, 26);
      roof.box(ax - 0.25, ax + 0.25, y, y + ah, az - 0.25, az + 0.25, { col: rgb('#3a3b3e') });
      blink.push(ax, y + ah + 0.3, az);
    }
  }

  // A tower with optional setbacks. Returns its record (also registered for collision and select).
  function tower(style, x0, x1, z0, z1, y0, top, o = {}) {
    const col = o.col || tintOf(style);
    const H = top - y0;
    const n = o.tiers ?? (H > 110 && R.rand() < 0.6 ? R.ri(2, 3) : 1);
    const fr = n === 1 ? [1] : n === 2 ? [0.7, 1] : [0.55, 0.82, 1];
    const tiers = [];
    let a0 = x0, a1 = x1, b0 = z0, b1 = z1, yb = y0;
    const edge = o.neon ?? (style === 'cyber' ? R.pick(NEON) : style === 'glass' && R.rand() < 0.3 ? R.pick(NEON) : null);
    for (let t = 0; t < n; t++) {
      const yt = y0 + H * fr[t];
      addBox(style, a0, a1, yb, yt, b0, b1, col);
      tiers.push({ x0: a0, x1: a1, z0: b0, z1: b1, h: yt });
      if (edge) neonEdges(a0, a1, b0, b1, Math.max(yb, y0 + 6), yt, edge, t === n - 1 || R.rand() < 0.5);
      const ix = (a1 - a0) * R.rr(0.1, 0.18), iz = (b1 - b0) * R.rr(0.1, 0.18);
      a0 += ix; a1 -= ix; b0 += iz; b1 -= iz;
      yb = yt;
    }
    const last = tiers[tiers.length - 1];
    rooftop(last.x0, last.x1, last.z0, last.z1, top);
    grid.add(n > 1 ? { x0, x1, z0, z1, h: top, tiers } : { x0, x1, z0, z1, h: top });
    const rec = { x0, x1, z0, z1, base: y0, h: top, style, zone: o.zone || 'downtown', kind: o.kind };
    buildings.push(rec);
    if (o.ad ?? (H > 80 && R.rand() < 0.4)) billboard(rec, o.adFace);
    return rec;
  }

  function billboard(b, faceIdx) {
    const f = faces(b.x0, b.x1, b.z0, b.z1)[faceIdx ?? (b.zone === 'downtown' && R.rand() < 0.6 ? 2 : R.ri(0, 3))];
    const w = Math.min(f.len * 0.86, 44), h = w / 2;
    const y1 = b.h - R.rr(4, Math.max(5, (b.h - b.base) * 0.35)), y0 = y1 - h;
    if (y0 < b.base + 10) return;
    quadAt(ads, f.x + f.nx * 0.7, f.z + f.nz * 0.7, f.nx, f.nz, w / 2, y0, y1, adUV(R.ri(0, 7)));
    b.ad = true;
  }

  // Street-level signage on the walls of a building: blade signs sticking out and flat shop signs.
  function streetSigns(x0, x1, z0, z1, density, maxY = 10, pool = false) {
    for (const f of faces(x0, x1, z0, z1)) {
      if (R.rand() > density) continue;
      for (let a = -f.len / 2 + 3; a < f.len / 2 - 3; a += R.rr(4, 9)) {
        const px = f.x + f.ax * a, pz = f.z + f.az * a;
        const gy = Math.max(terrainY(px + f.nx * 2, pz + f.nz * 2), LAND_Y - 0.5);
        const flick = R.rand() < 0.12;
        if (R.rand() < 0.62) {
          const k = R.ri(0, 15), w = R.rr(1.3, 1.9), h = w * 4 * R.rr(0.9, 1.1);
          const y0 = gy + R.rr(4, maxY), cx = px + f.nx * (0.4 + w / 2), cz = pz + f.nz * (0.4 + w / 2);
          const b = flick ? vsF : vs;
          quadAt(b, cx, cz, f.nz, -f.nx, w / 2, y0, y0 + h, vUV(k));
          quadAt(b, cx, cz, -f.nz, f.nx, w / 2, y0, y0 + h, vUV(k));
          if (pool) pools.top(cx - 5, cx + 5, cz - 5, cz + 5, gy + 0.06, 1, rgb(V_COLORS[k % V_COLORS.length]), [0, 0, 1, 0, 1, 1, 0, 1]);
        } else {
          const w = R.rr(5, 9), y0 = gy + R.rr(3, Math.max(3.5, maxY * 0.7));
          quadAt(flick ? hsF : hs, px + f.nx * 0.35, pz + f.nz * 0.35, f.nx, f.nz, w / 2, y0, y0 + w / 4, hUV(R.ri(0, 15)));
          a += w / 2;
        }
        signs.count++;
      }
    }
  }

  // ---------- downtown: Central, on the flat reclaimed waterfront ----------
  function downtownLot(L) {
    if (L.i === MEGA.i && L.j === MEGA.j) return;
    if (!L.built) {
      // a pocket plaza with lamps
      for (let k = 0; k < 4; k++) lamp(R.rr(L.x0 + 4, L.x1 - 4), LAND_Y + 4, R.rr(L.z0 + 4, L.z1 - 4), '#ff3cac');
      return;
    }
    const harbour = L.j <= 1 ? 1.35 : 1;
    if (R.rand() < 0.16) {
      // tenement cluster: four stained low blocks buried in signs
      const mx = (L.x0 + L.x1) / 2 + R.rr(-3, 3), mz = (L.z0 + L.z1) / 2 + R.rr(-3, 3);
      for (const [a0, a1, b0, b1] of [[L.x0, mx - 1.5, L.z0, mz - 1.5], [mx + 1.5, L.x1, L.z0, mz - 1.5], [L.x0, mx - 1.5, mz + 1.5, L.z1], [mx + 1.5, L.x1, mz + 1.5, L.z1]]) {
        tower('tenement', a0, a1, b0, b1, LAND_Y - 1, LAND_Y + R.rr(18, 48), { tiers: 1, kind: 'tenement block', ad: false });
        streetSigns(a0, a1, b0, b1, 0.95, 18, true);
      }
      return;
    }
    let pod = 0;
    if (R.rand() < 0.55) {
      pod = R.rr(9, 15);
      const st = R.rand() < 0.5 ? 'tenement' : 'cyber';
      addBox(st, L.x0 + 0.5, L.x1 - 0.5, LAND_Y - 1, LAND_Y + pod, L.z0 + 0.5, L.z1 - 0.5, tintOf(st));
      grid.add({ x0: L.x0 + 0.5, x1: L.x1 - 0.5, z0: L.z0 + 0.5, z1: L.z1 - 0.5, h: LAND_Y + pod });
      buildings.push({ x0: L.x0 + 0.5, x1: L.x1 - 0.5, z0: L.z0 + 0.5, z1: L.z1 - 0.5, base: LAND_Y - 1, h: LAND_Y + pod, style: st, zone: 'downtown', kind: 'podium mall' });
      neonBox(L.x0 + 0.2, L.x1 - 0.2, LAND_Y + pod - 0.5, LAND_Y + pod, L.z0 + 0.2, L.z0 + 0.6, R.pick(NEON));
      streetSigns(L.x0 + 0.5, L.x1 - 0.5, L.z0 + 0.5, L.z1 - 0.5, 0.9, pod - 5, true);
    }
    const inset = pod ? 3 : R.rr(1.5, 4);
    let rects = [[L.x0 + inset, L.x1 - inset, L.z0 + inset, L.z1 - inset]];
    if (R.rand() < 0.35) {
      const [a0, a1, b0, b1] = rects[0];
      if (R.rand() < 0.5) {
        const m = (a0 + a1) / 2;
        rects = [[a0, m - 3, b0, b1], [m + 3, a1, b0, b1]];
      } else {
        const m = (b0 + b1) / 2;
        rects = [[a0, a1, b0, m - 3], [a0, a1, m + 3, b1]];
      }
    }
    for (const [a0, a1, b0, b1] of rects) {
      const h = (R.rand() < 0.1 ? R.rr(200, 290) : R.rr(55, 170)) * harbour;
      const r = R.rand();
      const style = r < 0.45 ? 'glass' : r < 0.85 ? 'cyber' : 'hk';
      tower(style, a0, a1, b0, b1, LAND_Y + pod - 0.5, LAND_Y + pod + h, { kind: style === 'glass' ? 'office tower' : style === 'cyber' ? 'megacorp tower' : 'residential tower' });
      if (!pod) streetSigns(a0, a1, b0, b1, 0.8, 9, true);
    }
  }

  // ---------- the Mid-Levels: towers terraced into or sunk into the mountain ----------
  function hillLot(L) {
    if (!L.built) return;
    const e = L.nat - LAND_Y;
    const r = R.rand();
    const style = e > 150 && r < 0.4 ? 'glass' : r < 0.62 ? 'hk' : r < 0.82 ? 'tenement' : 'cyber';
    const w = R.rr(18, 27), d = R.rr(18, 27);
    const cx = R.rr(L.x0 + w / 2, L.x1 - w / 2), cz = R.rr(L.z0 + d / 2, L.z1 - d / 2);
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const probe = [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [cx, cz]].map(([x, z]) => natural(x, z));
    const lo = Math.min(...probe), hi = Math.max(...probe);
    const base = L.pad ? L.padY - 0.5 : lo - 3;
    const ground = L.pad ? L.padY : hi;
    const h = style === 'tenement' ? R.rr(25, 60) : R.rr(50, 150) * (1 - (e / HILL_MAX) * 0.35);
    const top = ground + h;
    const kind = style === 'hk' ? 'residential tower' : style === 'tenement' ? 'hillside tenement' : style === 'glass' ? 'luxury tower' : 'megacorp tower';
    if (style === 'hk' && R.rand() < 0.6) {
      // cruciform plan, the classic Hong Kong public-housing tower
      const col = tintOf('hk'), aw = w * 0.22, ad = d * 0.22;
      addBox('hk', x0, x1, base, top, cz - ad, cz + ad, col);
      addBox('hk', cx - aw, cx + aw, base, top, z0, z1, col);
      grid.add({ x0, x1, z0: cz - ad, z1: cz + ad, h: top });
      grid.add({ x0: cx - aw, x1: cx + aw, z0, z1, h: top });
      rooftop(cx - aw, cx + aw, cz - ad, cz + ad, top);
      const rec = { x0, x1, z0, z1, base, h: top, style, zone: 'hill', kind: 'cruciform tower', embedded: !L.pad };
      buildings.push(rec);
      if (R.rand() < 0.3) billboard({ ...rec, x0: cx - aw, x1: cx + aw, z0: cz - ad, z1: cz + ad }, 2);
      streetSigns(x0, x1, cz - ad, cz + ad, 0.3, 8);
    } else {
      const rec = tower(style, x0, x1, z0, z1, base, top, { zone: 'hill', kind, adFace: 2 });
      rec.embedded = !L.pad;
      streetSigns(x0, x1, z0, z1, style === 'tenement' ? 0.9 : 0.35, style === 'tenement' ? 16 : 8);
    }
    if (!L.pad) {
      // concrete footing where the tower bites into the slope
      roof.box(x0 - 1.2, x1 + 1.2, lo - 3, lo + 1.2, z0 - 1.2, z1 + 1.2, { col: rgb('#6a6963'), top: false });
    }
  }

  function lamp(x, y, z, hex) {
    lamps.push(x, y, z);
    lampCol.push(...rgb(hex));
  }

  for (const L of lots) {
    if (L.zone === 'downtown') downtownLot(L);
    else if (L.zone === 'hill') hillLot(L);
  }

  // street lamps: sodium and neon along Central's streets, and at hillside junctions
  const LAMP = ['#ffb35a', '#ffb35a', '#bfe8ff', '#ff3cac', '#05d9e8'];
  for (let j = 0; j <= 4; j++) {
    const z = GZ0 + j * CELL;
    for (let x = GX0; x <= GX0 + NI * CELL; x += 24) {
      lamp(x, LAND_Y + 6.5, z - 4.5, R.pick(LAMP));
      lamp(x + 12, LAND_Y + 6.5, z + 4.5, R.pick(LAMP));
    }
  }
  for (let i = 0; i <= NI; i++) {
    const x = GX0 + i * CELL;
    for (let z = GZ0; z < FOOT_Z; z += 24) lamp(x + 4.5, LAND_Y + 6.5, z + 12, R.pick(LAMP));
    for (let j = 5; j < 15; j++) {
      const z = GZ0 + j * CELL, y = natural(x, z);
      if (y < HILL_MAX + 10 && Math.abs(x) < 800) lamp(x + 3, y + 5.5, z + 3, R.pick(LAMP));
    }
  }

  // ---------- harbourfront: seawall, neon railing, Star Ferry pier ----------
  roof.box(-2600, 2600, -6, LAND_Y, SHORE_Z - 1.5, SHORE_Z, { col: rgb('#4c4d50'), top: false });
  neonBox(-1000, 1000, LAND_Y + 1, LAND_Y + 1.15, SHORE_Z + 0.2, SHORE_Z + 0.4, '#05d9e8');
  roof.box(PIER.x0, PIER.x1, -6, LAND_Y + 0.3, PIER.z0, PIER.z1, { col: rgb('#5a5b5e'), topScale: 0.2 });
  grid.add({ x0: PIER.x0, x1: PIER.x1, z0: PIER.z0, z1: PIER.z1, h: LAND_Y + 0.3 });
  for (const x of [PIER.x0 + 1, PIER.x1 - 1]) {
    for (let z = PIER.z0 + 2; z < PIER.z0 + 40; z += 8) roof.box(x - 0.2, x + 0.2, LAND_Y + 0.3, LAND_Y + 7, z - 0.2, z + 0.2, { col: rgb('#2e5a3c') });
  }
  roof.box(PIER.x0 - 1, PIER.x1 + 1, LAND_Y + 7, LAND_Y + 7.6, PIER.z0, PIER.z0 + 42, { col: rgb('#2e5a3c'), topScale: 0.2 });
  quadAt(hs, (PIER.x0 + PIER.x1) / 2, PIER.z0 + 42.2, 0, 1, 7, LAND_Y + 7.8, LAND_Y + 11.3, hUV(12));
  quadAt(hs, (PIER.x0 + PIER.x1) / 2, PIER.z0 - 0.2, 0, -1, 7, LAND_Y + 7.8, LAND_Y + 11.3, hUV(12));
  neonBox(PIER.x0 - 1, PIER.x1 + 1, LAND_Y + 7.6, LAND_Y + 7.8, PIER.z0 - 0.2, PIER.z0 + 42.2, '#39ff88');
  for (let z = PIER.z0 + 4; z < PIER.z1; z += 10) lamp((PIER.x0 + PIER.x1) / 2, LAND_Y + 6, z, '#bfe8ff');

  // ---------- Kowloon: the skyline across the harbour ----------
  const KR = createRng('kowloon-v1');
  const kowloon = [];
  for (let z = KOWLOON_Z - 30; z > -1560; z -= CELL) {
    for (let x = GX0 - CELL * 14; x < -GX0 + CELL * 14; x += CELL) {
      const far = (KOWLOON_Z - z) / 700;
      if (KR.rand() < 0.12 + far * 0.25 || (x > PIER.x0 - 50 && x < PIER.x1 + 40 && z > KOWLOON_Z - 80)) continue;
      const w = KR.rr(18, 36), d = KR.rr(18, 36);
      const x0 = x + 6 + KR.rr(0, 36 - w), z0 = z - 42 + KR.rr(0, 36 - d);
      const h = KR.rr(20, 150) * (1 - far * 0.5) * (1 - Math.min(1, Math.abs(x) / 1800) * 0.5);
      const st = KR.pick(['hk', 'hk', 'glass', 'cyber', 'tenement']);
      const b = tower(st, x0, x0 + w, z0, z0 + d, LAND_Y - 1, LAND_Y + h, { zone: 'kowloon', kind: 'Kowloon tower', ad: h > 70 && KR.rand() < 0.5, adFace: 0, tiers: 1 });
      kowloon.push(b);
    }
  }
  neonBox(-1400, 1400, LAND_Y + 1, LAND_Y + 1.2, KOWLOON_Z - 0.4, KOWLOON_Z - 0.2, '#ff3cac');
  roof.box(-2600, 2600, -6, LAND_Y, KOWLOON_Z, KOWLOON_Z + 1.5, { col: rgb('#4c4d50'), top: false });
  roof.box(PIER.x0, PIER.x1, -6, LAND_Y + 0.3, KOWLOON_Z - 2, KOWLOON_Z + 50, { col: rgb('#5a5b5e'), topScale: 0.2 });
  grid.add({ x0: PIER.x0, x1: PIER.x1, z0: KOWLOON_Z - 2, z1: KOWLOON_Z + 50, h: LAND_Y + 0.3 });

  // ---------- meshes ----------
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 1, ...o });
  const mats = {};
  for (const [k, f] of Object.entries(T.facade)) {
    mats[k] = std({ map: f.map, emissiveMap: f.emissiveMap, roughnessMap: f.roughnessMap, emissive: '#ffffff', emissiveIntensity: 0, vertexColors: true, metalness: k === 'glass' ? 0.55 : k === 'cyber' ? 0.4 : 0.05 });
  }
  mats.roof = std({ map: T.detail, vertexColors: true, roughness: 0.9 });
  mats.neon = new THREE.MeshBasicMaterial({ vertexColors: true });
  mats.vs = new THREE.MeshBasicMaterial({ map: T.vsigns });
  mats.vsF = new THREE.MeshBasicMaterial({ map: T.vsigns });
  mats.hs = new THREE.MeshBasicMaterial({ map: T.hsigns });
  mats.hsF = new THREE.MeshBasicMaterial({ map: T.hsigns });
  mats.ads = new THREE.MeshBasicMaterial({ map: T.ads });
  mats.pools = new THREE.MeshBasicMaterial({ map: ctxTextures.pool, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const add = (b, m, shadow = false) => {
    if (b.empty) return null;
    const mesh = new THREE.Mesh(b.build(), m);
    mesh.castShadow = mesh.receiveShadow = shadow;
    scene.add(mesh);
    return mesh;
  };
  for (const k of Object.keys(B)) add(B[k], mats[k], true);
  add(roof, mats.roof, true);
  add(neon, mats.neon);
  add(vs, mats.vs);
  add(vsF, mats.vsF);
  add(hs, mats.hs);
  add(hsF, mats.hsF);
  add(ads, mats.ads);
  const poolMesh = add(pools, mats.pools);
  if (poolMesh) poolMesh.renderOrder = 2;

  const pts = (arr, colors, size, opacity) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const m = new THREE.PointsMaterial({ map: ctxTextures.pool, vertexColors: !!colors, color: colors ? 0xffffff : 0xff3030, size, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    scene.add(p);
    return m;
  };
  const lampMat = pts(lamps, lampCol, 2.6, 1);
  const haloMat = pts(lamps, lampCol, 14, 0.3);
  const blinkMat = pts(blink, null, 5, 1);

  const city = {
    buildings, kowloon, mats, signs, lampCount: lamps.length / 3, poolTex: ctxTextures.pool,
    glow: 1, neonGlow: 1, signGlow: 1, adGlow: 1, lampGlow: 1,
    setNight(n, t) {
      const win = (0.04 + n * 1.1) * city.glow;
      for (const k of Object.keys(B)) mats[k].emissiveIntensity = win;
      mats.neon.color.setScalar((0.6 + n * 2.4) * city.neonGlow);
      const s = (0.7 + n * 1.5) * city.signGlow;
      mats.vs.color.setScalar(s);
      mats.hs.color.setScalar(s);
      const fl = (Math.sin(t * 23) > -0.2 || Math.sin(t * 2.3) > 0.4 ? 1 : 0.12) * (Math.sin(t * 61) > -0.9 ? 1 : 0.3);
      mats.vsF.color.setScalar(s * fl);
      mats.hsF.color.setScalar(s * (Math.sin(t * 17 + 1) > -0.4 || Math.sin(t * 1.7) > 0.2 ? 1 : 0.1));
      mats.ads.color.setScalar((0.75 + n * 1.1) * city.adGlow * (0.94 + Math.sin(t * 4) * 0.06));
      mats.pools.opacity = n * 0.55 * city.signGlow;
      lampMat.opacity = Math.min(1, (0.2 + n) * city.lampGlow);
      haloMat.opacity = n * 0.3 * city.lampGlow;
      blinkMat.opacity = (Math.sin(t * 2.6) > 0.55 ? 1 : 0.08) * (0.4 + n * 0.6);
    },
  };
  return city;
}

export { quadAt, rgb, faces };
