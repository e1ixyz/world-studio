import * as THREE from 'three';
import { GeoBuilder, createRng } from '../../engine/index.js';
import { Kit, face } from './kit.js';
import { WALL_TW, WALL_TH } from './textures.js';
import {
  groundY, terrainY, insideWalls, distToWall, roadClear, WALL, GATES, GATE_HALF, ROADS,
  KEEP, SEPT, PIT, PLAZA, FISH, FLEA, riverX, RIVER_W, shoreZ,
} from './layout.js';

const R = createRng('kings-landing-city');
const { rand, rr, ri, pick } = R;
const c3 = (hex, k = 1) => {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return [c.r, c.g, c.b];
};
const PLASTER = ['#efe2c0', '#e3cfa3', '#d8bf92', '#eadcb8', '#cfae84', '#c8a47c', '#f3ead3', '#e6c89a'];
const PLASTER_FLEA = ['#9a8466', '#8c765a', '#a8906e', '#7f6b52', '#b09a78'];
const ROOFS = ['#b5543a', '#a8482f', '#c0673f', '#9c4a33', '#b86b45', '#8f3f2c', '#c47a4f', '#a3563c'];
const ROOFS_FLEA = ['#7d6a4c', '#8b7a55', '#6b5e48', '#945a3c', '#7a4a34'];
const WOOD = '#8a6446';
const PLAIN_UV = [0.02, 0.15, 0.03, 0.15, 0.03, 0.2, 0.02, 0.2];
// Per-house wall color overrides, keyed by house index (the #id shown when selecting a house).
const HOUSE_COLORS = { 775: '#b8352a' };

export function buildCity(scene, T, grid) {
  const houses = [];
  const torches = [];
  const chunks = new Map();
  const chunk = (x, z) => {
    const k = `${Math.floor(x / 160)},${Math.floor(z / 160)}`;
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = { wall: new GeoBuilder(), roof: new GeoBuilder() }));
    return c;
  };

  // ---------- houses ----------
  const excluded = (x, z, rad) =>
    (Math.abs(x - KEEP.x) < KEEP.half + 14 + rad && Math.abs(z - KEEP.z) < KEEP.half + 14 + rad) ||
    Math.hypot(x - SEPT.x, z - SEPT.z) < 66 + rad ||
    Math.hypot(x - PIT.x, z - PIT.z) < PIT.r + 14 + rad ||
    Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 3 + rad ||
    Math.hypot(x - FISH.x, z - FISH.z) < FISH.r + 3 + rad;

  function addHouse(cx, cz, w, d, flea) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const gs = [groundY(x0, z0), groundY(x1, z0), groundY(x0, z1), groundY(x1, z1), groundY(cx, cz)];
    const g0 = Math.min(...gs), g1 = Math.max(...gs);
    if (g1 - g0 > 5) return;
    const nearKeep = Math.hypot(cx - KEEP.x, cz - KEEP.z) < 140;
    const stories = flea ? (rand() < 0.6 ? 1 : 2) : rand() < 0.2 ? 1 : rand() < (nearKeep ? 0.4 : 0.65) ? 2 : rand() < 0.8 ? 3 : 4;
    const top = g1 + stories * WALL_TH + 0.25;
    let col = c3(pick(flea ? PLASTER_FLEA : PLASTER), rr(0.86, 1.04));
    if (HOUSE_COLORS[houses.length]) col = c3(HOUSE_COLORS[houses.length]);
    const roofCol = c3(pick(flea ? ROOFS_FLEA : ROOFS), rr(0.82, 1.08));
    const B = chunk(cx, cz);
    const wallOpts = { col, tw: WALL_TW, th: WALL_TH, uo: ri(0, 3) / 4, vo: -top / WALL_TH, top: false };
    const jetty = !flea && stories >= 2 && rand() < 0.28;
    let rx0 = x0, rx1 = x1, rz0 = z0, rz1 = z1;
    if (jetty) {
      B.wall.box(x0, x1, g0 - 1, top - WALL_TH, z0, z1, wallOpts);
      rx0 -= 0.45; rx1 += 0.45; rz0 -= 0.45; rz1 += 0.45;
      B.wall.box(rx0, rx1, top - WALL_TH, top, rz0, rz1, { ...wallOpts, col: c3(WOOD, rr(0.85, 1.15)) });
      B.wall.box(rx0, rx1, top - WALL_TH - 0.35, top - WALL_TH, rz0, rz1, { col: c3('#5a3f2a'), tw: 1000, th: 1000, uo: 0.02, vo: 0.15, topScale: 0.0001 });
    } else {
      B.wall.box(x0, x1, g0 - 1, top, z0, z1, wallOpts);
    }
    const flat = !flea && rand() < 0.12;
    const alongX = rx1 - rx0 >= rz1 - rz0;
    const pyramid = !flat && Math.abs(w - d) < 1.2 && rand() < 0.5;
    const o = 0.4, ru = rr(0, 1), rv = rr(0, 1);
    let ridge = top;
    if (flat) {
      B.wall.top(rx0, rx1, rz0, rz1, top, 1, col, PLAIN_UV);
      for (const [a0, a1, b0, b1] of [[rx0, rx1, rz0, rz0 + 0.3], [rx0, rx1, rz1 - 0.3, rz1], [rx0, rx0 + 0.3, rz0, rz1], [rx1 - 0.3, rx1, rz0, rz1]])
        B.wall.box(a0, a1, top, top + 0.9, b0, b1, { col, tw: 1000, th: 1000, uo: 0.02, vo: 0.15, topScale: 0.0001 });
    } else if (pyramid) {
      const X0 = rx0 - o, X1 = rx1 + o, Z0 = rz0 - o, Z1 = rz1 + o;
      const rh = Math.min(X1 - X0, Z1 - Z0) * rr(0.35, 0.5);
      const ap = [(X0 + X1) / 2, top + rh, (Z0 + Z1) / 2];
      ridge = top + rh;
      const W2 = (X1 - X0) / 2, sl = Math.hypot(rh, (Z1 - Z0) / 2) / 1.2;
      const tri = [ru, rv, ru + W2, rv, ru + W2 / 2, rv + sl, ru + W2 / 2, rv + sl];
      face(B.roof, [X0, top, Z1], [X1, top, Z1], ap, ap, tri, roofCol);
      face(B.roof, [X1, top, Z1], [X1, top, Z0], ap, ap, tri, roofCol);
      face(B.roof, [X1, top, Z0], [X0, top, Z0], ap, ap, tri, roofCol);
      face(B.roof, [X0, top, Z0], [X0, top, Z1], ap, ap, tri, roofCol);
    } else {
      const X0 = rx0 - o, X1 = rx1 + o, Z0 = rz0 - o, Z1 = rz1 + o;
      const half = alongX ? (rz1 - rz0) / 2 : (rx1 - rx0) / 2;
      const rh = half * rr(0.55, 0.85);
      const y1 = top + rh;
      ridge = y1;
      const L = (alongX ? X1 - X0 : Z1 - Z0) / 2, sl = Math.hypot(rh, half + o) / 1.2;
      const uv = [ru, rv, ru + L, rv, ru + L, rv + sl, ru, rv + sl];
      const gcol = jetty ? c3(WOOD) : col;
      if (alongX) {
        const zm = (rz0 + rz1) / 2;
        face(B.roof, [X0, top, Z1], [X1, top, Z1], [X1, y1, zm], [X0, y1, zm], uv, roofCol);
        face(B.roof, [X1, top, Z0], [X0, top, Z0], [X0, y1, zm], [X1, y1, zm], uv, roofCol);
        face(B.wall, [rx1, top, rz1], [rx1, top, rz0], [rx1, y1, zm], [rx1, y1, zm], PLAIN_UV, gcol);
        face(B.wall, [rx0, top, rz0], [rx0, top, rz1], [rx0, y1, zm], [rx0, y1, zm], PLAIN_UV, gcol);
      } else {
        const xm = (rx0 + rx1) / 2;
        face(B.roof, [X1, top, Z1], [X1, top, Z0], [xm, y1, Z0], [xm, y1, Z1], uv, roofCol);
        face(B.roof, [X0, top, Z0], [X0, top, Z1], [xm, y1, Z1], [xm, y1, Z0], uv, roofCol);
        face(B.wall, [rx0, top, rz1], [rx1, top, rz1], [xm, y1, rz1], [xm, y1, rz1], PLAIN_UV, gcol);
        face(B.wall, [rx1, top, rz0], [rx0, top, rz0], [xm, y1, rz0], [xm, y1, rz0], PLAIN_UV, gcol);
      }
      if (rand() < 0.4) {
        const chx = alongX ? rr(rx0 + 1, rx1 - 1.6) : (rx0 + rx1) / 2 + rr(0.4, 1.2);
        const chz = alongX ? (rz0 + rz1) / 2 + rr(0.4, 1.2) : rr(rz0 + 1, rz1 - 1.6);
        B.wall.box(chx, chx + 0.7, top, y1 + 0.9, chz, chz + 0.7, { col: c3('#b7a88f'), tw: 1000, th: 1000, uo: 0.02, vo: 0.15, topScale: 0.0001 });
      }
    }
    grid.add({ x0, x1, z0, z1, h: top });
    houses.push({ x0, x1, z0, z1, top, ridge, stories, flea, roof: flat ? 'flat' : pyramid ? 'hipped' : 'gabled' });
  }

  const CELL = 10.5;
  for (let gx = -330; gx < 340; gx += CELL) {
    for (let gz = -340; gz < 185; gz += CELL) {
      const cx = gx + rr(-1.8, 1.8), cz = gz + rr(-1.8, 1.8);
      if (!insideWalls(cx, cz)) continue;
      const flea = Math.hypot(cx - FLEA.x, cz - FLEA.z) < FLEA.r;
      const w = flea ? rr(4.5, 7.2) : rr(5.6, 8.8), d = flea ? rr(4.5, 7.2) : rr(5.6, 8.8);
      const rad = Math.hypot(w, d) / 2;
      if (distToWall(cx, cz) < rad + 8) continue;
      if (roadClear(cx, cz) < rad - 1.6) continue;
      if (excluded(cx, cz, rad)) continue;
      if (rand() < (flea ? 0.03 : 0.09)) continue;
      addHouse(cx, cz, w, d, flea);
    }
  }

  const wallMat = new THREE.MeshStandardMaterial({ map: T.plaster, vertexColors: true, roughness: 0.92, emissive: '#ffb060', emissiveMap: T.plasterGlow, emissiveIntensity: 0 });
  const roofMat = new THREE.MeshStandardMaterial({ map: T.roof, vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  T.roof.repeat.set(1, 1);
  for (const c of chunks.values()) {
    for (const [k, mat] of [['wall', wallMat], ['roof', roofMat]]) {
      if (c[k].empty) continue;
      const m = new THREE.Mesh(c[k].build(), mat);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
  }

  // ---------- streets and squares ----------
  const cobbleMat = new THREE.MeshStandardMaterial({ map: T.cobble, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const roadGeos = [];
  for (const r of ROADS) {
    const n = r.pts.length, hw = r.w / 2;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i < n; i++) {
      const [x, z] = r.pts[i];
      const [ax, az] = r.pts[Math.max(0, i - 1)], [bx, bz] = r.pts[Math.min(n - 1, i + 1)];
      let tx = bx - ax, tz = bz - az;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      for (const s of [-1, 0, 1]) {
        const px = x - tz * hw * s, pz = z + tx * hw * s;
        pos.push(px, groundY(px, pz) + 0.12, pz);
        uv.push((s + 1) * hw / 3, (i * r.step) / 3);
      }
      if (i < n - 1) {
        const a = i * 3;
        for (const [p, q] of [[0, 1], [1, 2]]) idx.push(a + p, a + q, a + p + 3, a + q, a + q + 3, a + p + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    roadGeos.push(g);
  }
  for (const sq of [PLAZA, FISH]) roadGeos.push(disc(sq.x, sq.z, sq.r));
  for (const g of roadGeos) {
    const m = new THREE.Mesh(g, cobbleMat);
    m.receiveShadow = true;
    scene.add(m);
  }

  // ---------- city walls, towers, gates ----------
  const kit = new Kit();
  const wallTowers = [];
  const wallTop = (x, z) => groundY(x, z) + 12;
  function wallRun(ax, az, bx, bz, { key = 'wall', thick = 4.5, topFn = wallTop, crenel = true, collide = true } = {}) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) return;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const rot = Math.atan2(-dz, dx);
    const n = Math.ceil(len / 5), pl = len / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * pl;
      const x = ax + dx * t, z = az + dz * t;
      const top = topFn(x, z);
      const low = Math.min(groundY(x - dx * pl / 2, z - dz * pl / 2), groundY(x + dx * pl / 2, z + dz * pl / 2)) - 3;
      kit.box(key, pl + 0.25, thick, x, low, top, z, rot);
      if (crenel) {
        for (let m = 0; m < 2; m++) {
          const mt = t - pl / 2 + (m + 0.25) * (pl / 2);
          for (const side of [-1, 1]) {
            const ox = -dz * side * (thick / 2 - 0.35), oz = dx * side * (thick / 2 - 0.35);
            kit.box(key, 1.3, 0.7, ax + dx * mt + ox, top, top + 1.4, az + dz * mt + oz, rot);
          }
        }
      }
    }
    if (collide) {
      const m = Math.ceil(len / 2);
      for (let i = 0; i <= m; i++) {
        const x = ax + dx * (i / m) * len, z = az + dz * (i / m) * len;
        const h = thick / 2;
        grid.add({ x0: x - h, x1: x + h, z0: z - h, z1: z + h, h: topFn(x, z) });
      }
    }
  }
  function roundTower(x, z, r, h, key = 'wall', roof = null) {
    const g = groundY(x, z), top = g + h;
    kit.cyl(key, r, r * 1.08, x, g - 4, top, z, 16);
    for (let i = 0; i < 12; i++) {
      if (i % 2) continue;
      const a = (i / 12) * Math.PI * 2;
      kit.box(key, 1.6, 0.8, x + Math.cos(a) * (r - 0.4), top, top + 1.5, z + Math.sin(a) * (r - 0.4), -a + Math.PI / 2);
    }
    kit.cyl(key, r + 0.6, r, x, top - 0.8, top, z, 16);
    if (roof) kit.cyl(roof, 0, r + 0.8, x, top, top + r * 1.6, z, 16);
    grid.add({ x0: x - r * 0.9, x1: x + r * 0.9, z0: z - r * 0.9, z1: z + r * 0.9, h: top });
    wallTowers.push({ x, z, r, top });
  }

  for (let i = 0; i < WALL.length; i++) {
    const [ax, az] = WALL[i], [bx, bz] = WALL[(i + 1) % WALL.length];
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const cuts = GATES.filter((g) => g.seg === i).map((g) => g.along).sort((a, b) => a - b);
    let s = 0;
    for (const c of cuts) {
      wallRun(ax + dx * s, az + dz * s, ax + dx * (c - GATE_HALF), az + dz * (c - GATE_HALF));
      s = c + GATE_HALF;
    }
    wallRun(ax + dx * s, az + dz * s, bx, bz);
    roundTower(ax, az, 6.5, 17);
    const nt = Math.floor(len / 75);
    for (let k = 1; k <= nt; k++) {
      const t = (k / (nt + 1)) * len;
      if (cuts.some((c) => Math.abs(c - t) < GATE_HALF + 10)) continue;
      roundTower(ax + dx * t, az + dz * t, 5, 15);
    }
  }
  const bannerKit = [];
  for (const g of GATES) {
    const gy = groundY(g.x, g.z);
    const rot = Math.atan2(-g.dz, g.dx);
    for (const s of [-1, 1]) {
      const tx = g.x + g.dx * 9.5 * s, tz = g.z + g.dz * 9.5 * s;
      const top = groundY(tx, tz) + 20;
      kit.box('wall', 9, 12, tx, groundY(tx, tz) - 4, top, tz, rot);
      for (const [u, v] of [[-3.5, -5.5], [0, -5.5], [3.5, -5.5], [-3.5, 5.5], [0, 5.5], [3.5, 5.5], [-4, 0], [4, 0]]) {
        const ox = g.dx * u - g.dz * v, oz = g.dz * u + g.dx * v;
        kit.box('wall', 1.5, 1.2, tx + ox, top, top + 1.6, tz + oz, rot);
      }
      kit.box('roofDark', 9.6, 12.6, tx, top - 0.6, top, tz, rot);
      const h = 4.5;
      grid.add({ x0: tx - h, x1: tx + h, z0: tz - h, z1: tz + h, h: top });
      torches.push([tx + g.nx * 6.6 - g.dx * 5 * s, groundY(tx, tz) + 5, tz + g.nz * 6.6 - g.dz * 5 * s]);
      torches.push([tx - g.nx * 6.6 - g.dx * 5 * s, groundY(tx, tz) + 5, tz - g.nz * 6.6 - g.dz * 5 * s]);
      bannerKit.push({ x: tx + g.nx * 6.15, z: tz + g.nz * 6.15, y: top - 1.5, rot: Math.atan2(g.nx, g.nz), h: 8 });
    }
    // arch lintel over the gate passage (visual only, above head height)
    kit.box('wall', 10.5, 11, g.x, gy + 10, gy + 20, g.z, rot);
  }

  // ---------- market stalls, well ----------
  const stallB = new GeoBuilder();
  const CLOTH = ['#a8322b', '#d9a63a', '#3f6b8c', '#e5dcc7', '#5d7f3a', '#8a3f76', '#c0692c'];
  const stall = (x, z, dir) => {
    const w = 3, d = 2.2, g = groundY(x, z);
    const fx = Math.cos(dir), fz = Math.sin(dir);
    const alongX = Math.abs(fz) > Math.abs(fx);
    const hx = alongX ? w / 2 : d / 2, hz = alongX ? d / 2 : w / 2;
    const wood = c3(WOOD, rr(0.8, 1.1));
    stallB.box(x - hx + 0.2, x + hx - 0.2, g - 0.3, g + 1, z - hz + 0.2, z + hz - 0.2, { col: wood });
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) stallB.box(x + px * hx - 0.08, x + px * hx + 0.08, g, g + 2.6, z + pz * hz - 0.08, z + pz * hz + 0.08, { col: wood });
    const cl = c3(pick(CLOTH));
    const hi = g + 2.8, lo = g + 2.2;
    // awning slopes down toward the customer side
    const front = alongX ? (fz > 0 ? 1 : -1) : fx > 0 ? 1 : -1;
    if (alongX) {
      const zf = z + front * (hz + 0.6), zb = z - front * hz;
      face2(stallB, [x - hx - 0.2, lo, zf], [x + hx + 0.2, lo, zf], [x + hx + 0.2, hi, zb], [x - hx - 0.2, hi, zb], cl);
    } else {
      const xf = x + front * (hx + 0.6), xb = x - front * hx;
      face2(stallB, [xf, lo, z - hz - 0.2], [xf, lo, z + hz + 0.2], [xb, hi, z + hz + 0.2], [xb, hi, z - hz - 0.2], cl);
    }
    for (let i = 0; i < 4; i++) {
      const gc = c3(pick(['#c43b2b', '#e0a32f', '#7da03a', '#a0522d', '#d9c27a', '#6b3a6b']));
      const px = x + rr(-hx + 0.4, hx - 0.6), pz = z + rr(-hz + 0.4, hz - 0.6);
      stallB.box(px, px + 0.35, g + 1, g + 1.25, pz, pz + 0.35, { col: gc });
    }
    grid.add({ x0: x - hx + 0.2, x1: x + hx - 0.2, z0: z - hz + 0.2, z1: z + hz - 0.2, h: g + 1 });
  };
  function face2(B, a, b, c, d, col) {
    face(B, a, b, c, d, [0, 0, 1, 0, 1, 1, 0, 1], col);
    face(B, b, a, d, c, [0, 0, 1, 0, 1, 1, 0, 1], col);
  }
  const stalls = [];
  for (const [sq, n, rad] of [[PLAZA, 14, PLAZA.r - 6], [FISH, 7, FISH.r - 4]]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.2;
      const x = sq.x + Math.cos(a) * rad, z = sq.z + Math.sin(a) * rad;
      if (roadClear(x, z, 8) < 1.5) continue;
      stall(x, z, a + Math.PI);
      stalls.push({ x, z, square: sq.name });
    }
  }
  const stallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const stallMesh = new THREE.Mesh(stallB.build(), stallMat);
  stallMesh.castShadow = stallMesh.receiveShadow = true;
  scene.add(stallMesh);
  {
    const g = groundY(PLAZA.x, PLAZA.z);
    kit.cyl('wall', 2.4, 2.6, PLAZA.x, g - 0.5, g + 1.1, PLAZA.z, 16);
    kit.cyl('dark', 1.9, 1.9, PLAZA.x, g + 1.1, g + 1.15, PLAZA.z, 16);
    for (const s of [-1, 1]) kit.box('woodK', 0.3, 0.3, PLAZA.x + s * 2, g + 1, g + 3.6, PLAZA.z);
    kit.box('woodK', 4.6, 0.3, PLAZA.x, g + 3.4, g + 3.7, PLAZA.z);
    kit.cyl('roofDark', 0, 2.8, PLAZA.x, g + 3.7, g + 5.2, PLAZA.z, 4, { theta: Math.PI / 4 });
    grid.add({ x0: PLAZA.x - 2.4, x1: PLAZA.x + 2.4, z0: PLAZA.z - 2.4, z1: PLAZA.z + 2.4, h: g + 1.1 });
  }

  // ---------- torches along the streets ----------
  for (const r of ROADS) {
    let side = 1;
    for (let i = 3; i < r.pts.length - 3; i += 11) {
      const [x, z] = r.pts[i], [bx, bz] = r.pts[i + 1];
      if (!insideWalls(x, z) && Math.hypot(x, z) > 480) continue;
      let tx = bx - x, tz = bz - z;
      const l = Math.hypot(tx, tz) || 1;
      const px = x - (tz / l) * (r.w / 2 + 0.5) * side, pz = z + (tx / l) * (r.w / 2 + 0.5) * side;
      side = -side;
      if (grid.pointInside(px, pz, 0.3)) continue;
      const g = groundY(px, pz);
      kit.cyl('woodK', 0.09, 0.12, px, g, g + 2.5, pz, 6);
      kit.cyl('dark', 0.22, 0.12, px, g + 2.5, g + 2.75, pz, 6);
      torches.push([px, g + 2.95, pz]);
    }
  }

  // ---------- trees: cypress and olive ----------
  const trees = [];
  const addTree = (x, z, kind, s) => {
    const g = groundY(x, z);
    trees.push({ x, z, y: g, kind, s });
    if (Math.abs(x) < 900 && Math.abs(z) < 900) grid.add({ x0: x - 0.35, x1: x + 0.35, z0: z - 0.35, z1: z + 0.35, h: g + 4 });
  };
  let tries = 0;
  while (trees.length < 1700 && tries++ < 20000) {
    const forest = rand() < 0.45;
    const x = forest ? (rand() < 0.5 ? rr(420, 1300) : rr(-1300, -520)) : rr(-1100, 1100);
    const z = forest ? rr(-1300, 150) : rr(-1100, 200);
    if (insideWalls(x, z) || distToWall(x, z) < 22) continue;
    if (terrainY(x, z) < 1.8 || Math.abs(x - riverX(z)) < RIVER_W + 6) continue;
    if (roadClear(x, z, 8) < 3) continue;
    if (Math.hypot(x, z) < 420 && rand() < 0.5) continue;
    addTree(x, z, rand() < (forest ? 0.35 : 0.55) ? 'cypress' : 'olive', rr(0.8, 1.35));
  }
  // gardens inside the walls
  for (let i = 0; i < 160; i++) {
    const x = rr(-300, 320), z = rr(-320, 170);
    if (!insideWalls(x, z) || grid.pointInside(x, z, 2.2) || roadClear(x, z, 6) < 1.5 || distToWall(x, z) < 8) continue;
    if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 2 || Math.hypot(x - FISH.x, z - FISH.z) < FISH.r + 2) continue;
    if (Math.hypot(x - PIT.x, z - PIT.z) < PIT.r + 4) continue;
    addTree(x, z, rand() < 0.6 ? 'cypress' : 'olive', rr(0.7, 1.1));
  }
  const treeMeshes = buildTrees(scene, trees);

  return {
    houses, torches, stalls, trees, wallTowers, bannerKit, kit, treeMeshes,
    mats: { wall: wallMat, roof: roofMat, cobble: cobbleMat },
    roundTower, wallRun,
  };
}

function disc(cx, cz, r) {
  const rings = 10, segs = 48;
  const pos = [cx, groundY(cx, cz) + 0.14, cz], uv = [cx / 3, cz / 3], idx = [];
  for (let i = 1; i <= rings; i++) {
    const rr_ = (i / rings) * r;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = cx + Math.cos(a) * rr_, z = cz + Math.sin(a) * rr_;
      pos.push(x, groundY(x, z) + 0.14, z);
      uv.push(x / 3, z / 3);
    }
  }
  const id = (i, j) => (i === 0 ? 0 : 1 + (i - 1) * segs + (j % segs));
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      if (i === 0) idx.push(0, id(1, j + 1), id(1, j));
      else idx.push(id(i, j), id(i, j + 1), id(i + 1, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const GREENS = ['#2f4a26', '#344f2a', '#3c5a2e', '#2a4222', '#40582f'];
const OLIVES = ['#6b7a4a', '#5e7042', '#7a8753', '#56693d', '#4c6a35'];
function buildTrees(scene, trees) {
  const cyp = trees.filter((t) => t.kind === 'cypress'), oli = trees.filter((t) => t.kind === 'olive');
  const trunkG = new THREE.CylinderGeometry(0.16, 0.26, 1, 6).translate(0, 0.5, 0);
  const cypG = new THREE.ConeGeometry(1.05, 1, 8).translate(0, 0.5, 0);
  const oliG = new THREE.IcosahedronGeometry(1, 1).scale(1, 0.72, 1);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4431', roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkG, trunkMat, trees.length);
  const cm = new THREE.InstancedMesh(cypG, leafMat, Math.max(1, cyp.length));
  const om = new THREE.InstancedMesh(oliG, leafMat, Math.max(1, oli.length));
  const o = new THREE.Object3D(), c = new THREE.Color();
  trees.forEach((t, i) => {
    o.position.set(t.x, t.y - 0.2, t.z);
    o.rotation.set(0, 0, 0);
    o.scale.set(t.s, t.kind === 'cypress' ? 1.6 * t.s : 2.6 * t.s, t.s);
    o.updateMatrix();
    trunks.setMatrixAt(i, o.matrix);
  });
  cyp.forEach((t, i) => {
    o.position.set(t.x, t.y + 1.1 * t.s, t.z);
    o.scale.set(t.s, 8.5 * t.s, t.s);
    o.updateMatrix();
    cm.setMatrixAt(i, o.matrix);
    cm.setColorAt(i, c.set(GREENS[i % GREENS.length]));
  });
  oli.forEach((t, i) => {
    o.position.set(t.x, t.y + 3.3 * t.s, t.z);
    o.rotation.set(0, i, 0);
    o.scale.set(2.6 * t.s, 2.3 * t.s, 2.6 * t.s);
    o.updateMatrix();
    om.setMatrixAt(i, o.matrix);
    om.setColorAt(i, c.set(OLIVES[i % OLIVES.length]));
  });
  for (const m of [trunks, cm, om]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    scene.add(m);
  }
  return { trunks, cypress: cm, olive: om, leafMat };
}
