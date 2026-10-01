import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeoBuilder } from '../../engine/core/geo.js';
import { CollisionGrid } from '../../engine/core/collision.js';
import { hazeFog } from '../../engine/world/scenery.js';
import { rand, rr, ri, pick } from './rng.js';
import { FACADE_TW, FACADE_TH } from './textures.js';
import {
  BLOCKS, BLOCK, ROAD, SIDEWALK, CURB, PERIOD, HALF, CITY_EDGE, PROMENADE, PARK_LANE,
  roadC, blockMin, mod,
} from './config.js';

const STYLE_KEYS = ['glass', 'office', 'brick', 'modern'];
const TINTS = {
  glass: ['#ffffff', '#d6ecff', '#dcfff2', '#ffe9d2', '#e8e0ff'],
  office: ['#ffffff', '#f3ead6', '#e4e4e4', '#d8d0bf', '#f6e3d0'],
  brick: ['#ffffff', '#f0cdbb', '#d69c86', '#f3dcc0', '#c9b1a6'],
  modern: ['#ffffff', '#c9cdd6', '#b5ab9b', '#a9b6c4'],
};
const NEON = ['#ff2d6f', '#2de2ff', '#ffd02d', '#7dff4a', '#b34dff', '#ff7a1a', '#ff4df0'];
const TREE_GREENS = ['#3f7d2c', '#4f8a33', '#2f6b2a', '#5e9a3a', '#3b6f36', '#6d8f2f'];
const WHITE = [1, 1, 1];
const c3 = (hex, k = 1) => {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return [c.r, c.g, c.b];
};

export function buildCity(scene, T) {
  const grid = new CollisionGrid(32);
  const blocks = [];
  const buildings = [];
  const lamps = [];
  const trees = [];
  const roofBoxes = [];
  const tanks = [];
  const antennas = [];
  const signs = [];
  const ponds = [];
  const parks = [];

  const chunks = new Map();
  const chunk = (i, j) => {
    const k = `${(i / 3) | 0},${(j / 3) | 0}`;
    let c = chunks.get(k);
    if (!c) {
      c = { roof: new GeoBuilder() };
      for (const s of STYLE_KEYS) c[s] = new GeoBuilder();
      chunks.set(k, c);
    }
    return c;
  };

  const slabB = new GeoBuilder();
  const grassB = new GeoBuilder();
  const pathB = new GeoBuilder();
  const roadB = new GeoBuilder();
  const interB = new GeoBuilder();
  const crossB = new GeoBuilder();

  const addTree = (x, z, s = rr(0.85, 1.25)) => {
    trees.push({ x, z, s, y: CURB, col: pick(TREE_GREENS) });
    grid.add({ x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3, h: 3 });
  };

  // ---------- buildings ----------
  function addBuilding(ch, x0, x1, z0, z1, h, style) {
    const tint = c3(pick(TINTS[style]), rr(0.8, 1.06));
    const rk = rr(0.7, 1.05);
    const roofCol = [rk, rk, rk * 0.97];
    const uo = ri(0, 7) / 8;
    const vo = ri(0, 7) / 8;
    const B = ch[style];
    const tiers = h > 55 && rand() < 0.65 ? ri(2, 3) : 1;
    let y = 0;
    let ax0 = x0, ax1 = x1, az0 = z0, az1 = z1;
    const tierRects = [];
    for (let t = 0; t < tiers; t++) {
      const last = t === tiers - 1;
      let th = last ? h - y : h * (t === 0 ? rr(0.45, 0.62) : rr(0.18, 0.28));
      th = Math.max(3.6, Math.round(th / 3.6) * 3.6);
      B.box(ax0, ax1, y, y + th, az0, az1, { col: tint, tw: FACADE_TW, th: FACADE_TH, uo, vo, top: false });
      ch.roof.box(ax0 - 0.3, ax1 + 0.3, y + th, y + th + 0.7, az0 - 0.3, az1 + 0.3, { col: roofCol, tw: 4, th: 4, topScale: 0.12 });
      tierRects.push({ x0: ax0 - 0.3, x1: ax1 + 0.3, z0: az0 - 0.3, z1: az1 + 0.3, h: y + th + 0.7 });
      y += th;
      if (!last) {
        const sx = (ax1 - ax0) * rr(0.09, 0.18);
        const sz = (az1 - az0) * rr(0.09, 0.18);
        ax0 += sx; ax1 -= sx; az0 += sz; az1 -= sz;
      }
    }
    const topY = y + 0.7;
    const fw = ax1 - ax0, fd = az1 - az0;
    if (fw > 7 && fd > 7) {
      const n = ri(0, 3);
      for (let k = 0; k < n; k++) {
        const sx = rr(1.4, Math.min(4, fw / 3)), sz = rr(1.4, Math.min(4, fd / 3)), sy = rr(0.9, 2.4);
        roofBoxes.push({ x: rr(ax0 + sx / 2 + 1, ax1 - sx / 2 - 1), y: topY + sy / 2, z: rr(az0 + sz / 2 + 1, az1 - sz / 2 - 1), sx, sy, sz });
      }
      if (style === 'brick' && h < 45 && rand() < 0.4) {
        tanks.push({ x: rr(ax0 + 3, ax1 - 3), y: topY, z: rr(az0 + 3, az1 - 3), s: rr(1.2, 1.8) });
      }
      if (h > 95 && rand() < 0.75) {
        antennas.push({ x: (ax0 + ax1) / 2 + rr(-fw / 4, fw / 4), y: topY, z: (az0 + az1) / 2 + rr(-fd / 4, fd / 4), h: rr(8, 24) });
      }
    }
    // neon signs on the base facade
    if (h > 16 && rand() < 0.28) {
      const side = ri(0, 3);
      const vert = rand() < 0.55;
      const w = vert ? rr(1.4, 2) : rr(5, Math.min(12, (side < 2 ? x1 - x0 : z1 - z0) - 2));
      const hh = vert ? rr(5, 9) : rr(1.2, 1.8);
      const sy = rr(4.5 + hh / 2, Math.min(h * 0.5, 16));
      const col = pick(NEON);
      if (side === 0) signs.push({ x: rr(x0 + w / 2 + 1, x1 - w / 2 - 1), y: sy, z: z1 + 0.1, ry: 0, w, h: hh, col });
      if (side === 1) signs.push({ x: rr(x0 + w / 2 + 1, x1 - w / 2 - 1), y: sy, z: z0 - 0.1, ry: Math.PI, w, h: hh, col });
      if (side === 2) signs.push({ x: x1 + 0.1, y: sy, z: rr(z0 + w / 2 + 1, z1 - w / 2 - 1), ry: Math.PI / 2, w, h: hh, col });
      if (side === 3) signs.push({ x: x0 - 0.1, y: sy, z: rr(z0 + w / 2 + 1, z1 - w / 2 - 1), ry: -Math.PI / 2, w, h: hh, col });
    }
    const r = { x0, x1, z0, z1, h: topY, style, tiers: tierRects };
    grid.add(r);
    buildings.push(r);
  }

  const splits = (start, len, n) => {
    const a = [start];
    for (let k = 1; k < n; k++) a.push(start + (len * k) / n + rr(-0.12, 0.12) * (len / n));
    a.push(start + len);
    return a;
  };

  function cityBlock(i, j, x0, z0) {
    const ch = chunk(i, j);
    const IN = BLOCK - 2 * SIDEWALK;
    const ix0 = x0 + SIDEWALK, iz0 = z0 + SIDEWALK;
    const cx = x0 + BLOCK / 2, cz = z0 + BLOCK / 2;
    const d = Math.hypot(cx, cz) / HALF;
    const dt = Math.exp(-((d * 2.3) ** 2));
    const layouts =
      dt > 0.55 ? [[1, 1], [1, 2], [2, 1], [2, 2], [2, 2]]
      : dt > 0.2 ? [[2, 2], [2, 3], [3, 2], [2, 2], [1, 2]]
      : [[3, 3], [2, 3], [3, 2], [3, 4], [4, 3], [2, 2]];
    const [nc, nr] = pick(layouts);
    const xs = splits(ix0, IN, nc);
    const zs = splits(iz0, IN, nr);
    for (let c = 0; c < nc; c++) {
      for (let r = 0; r < nr; r++) {
        const lx0 = xs[c] + rr(0.6, 2.2), lx1 = xs[c + 1] - rr(0.6, 2.2);
        const lz0 = zs[r] + rr(0.6, 2.2), lz1 = zs[r + 1] - rr(0.6, 2.2);
        if (dt < 0.3 && rand() < 0.05) {
          const n = ri(2, 5);
          for (let k = 0; k < n; k++) addTree(rr(lx0 + 2, lx1 - 2), rr(lz0 + 2, lz1 - 2));
          continue;
        }
        let h = 8 + rand() ** 2 * 22 + dt * (25 + rand() * 170) * (nc * nr <= 2 ? 1.2 : 1);
        if (rand() < 0.025) h += rr(50, 110);
        const style =
          h > 80 ? pick(['glass', 'glass', 'modern', 'office'])
          : h > 35 ? pick(['glass', 'office', 'modern', 'office', 'brick'])
          : pick(['brick', 'brick', 'office', 'modern']);
        addBuilding(ch, lx0, lx1, lz0, lz1, h, style);
      }
    }
  }

  function parkBlock(x0, z0) {
    const cx = x0 + BLOCK / 2, cz = z0 + BLOCK / 2;
    const a = x0 + SIDEWALK, b = x0 + BLOCK - SIDEWALK;
    const za = z0 + SIDEWALK, zb = z0 + BLOCK - SIDEWALK;
    grassB.top(a, b, za, zb, CURB + 0.02, 1 / 8);
    pathB.top(cx - 2, cx + 2, za, zb, CURB + 0.04, 0.25);
    pathB.top(a, b, cz - 2, cz + 2, CURB + 0.05, 0.25);
    const qx = rand() < 0.5 ? -1 : 1, qz = rand() < 0.5 ? -1 : 1;
    const pr = rr(6, 9);
    const px = cx + qx * 15, pz = cz + qz * 15;
    ponds.push({ x: px, z: pz, r: pr });
    for (let k = 0; k < 40; k++) {
      const x = rr(a + 1.5, b - 1.5), z = rr(za + 1.5, zb - 1.5);
      if (Math.abs(x - cx) < 3.5 || Math.abs(z - cz) < 3.5) continue;
      if (Math.hypot(x - px, z - pz) < pr + 2) continue;
      addTree(x, z, rr(0.9, 1.5));
    }
    parks.push({ cx, cz });
  }

  function plazaBlock(i, j, x0, z0) {
    const ch = chunk(i, j);
    const cx = x0 + BLOCK / 2, cz = z0 + BLOCK / 2;
    const tiers = [[16, 0, 90], [13, 90, 170], [10, 170, 240], [7, 240, 290]];
    const tierRects = tiers.map(([s, , y1]) => ({ x0: cx - s - 0.4, x1: cx + s + 0.4, z0: cz - s - 0.4, z1: cz + s + 0.4, h: y1 + 1.2 }));
    tierRects.push({ x0: cx - 5, x1: cx + 5, z0: cz - 5, z1: cz + 5, h: 300 });
    for (const [s, y0, y1] of tiers) {
      ch.glass.box(cx - s, cx + s, y0, y1, cz - s, cz + s, { col: c3('#dff4ff'), tw: FACADE_TW, th: FACADE_TH, top: false });
      ch.roof.box(cx - s - 0.4, cx + s + 0.4, y1, y1 + 1.2, cz - s - 0.4, cz + s + 0.4, { col: c3('#9aa6b0'), tw: 4, th: 4, topScale: 0.12 });
    }
    ch.roof.box(cx - 5, cx + 5, 291.2, 300, cz - 5, cz + 5, { col: c3('#b8c2cc'), tw: 4, th: 4, topScale: 0.12 });
    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 1.2, 60, 8).translate(0, 30, 0),
      new THREE.MeshStandardMaterial({ color: 0xc8d0d8, metalness: 0.9, roughness: 0.25 })
    );
    spire.position.set(cx, 300, cz);
    spire.castShadow = true;
    scene.add(spire);
    const r = { x0: cx - 16, x1: cx + 16, z0: cz - 16, z1: cz + 16, h: 360, style: 'tower', tiers: tierRects };
    grid.add(r);
    buildings.push(r);
    for (const [dx, dz] of [[-22, -22], [22, -22], [-22, 22], [22, 22], [-22, 8], [22, 8], [-22, -8], [22, -8]]) addTree(cx + dx, cz + dz, 1.1);
    return new THREE.Vector3(cx, 361, cz);
  }

  // ---------- block layout ----------
  const mid = (BLOCKS - 1) / 2;
  const types = [];
  for (let i = 0; i < BLOCKS; i++) {
    types.push([]);
    for (let j = 0; j < BLOCKS; j++) {
      let t = 'city';
      if (i === mid && j === mid) t = 'plaza';
      else if (Math.max(Math.abs(i - mid), Math.abs(j - mid)) > 1 && rand() < 0.075) t = 'park';
      types[i].push(t);
    }
  }
  types[mid][mid + 2] = 'park';

  let towerTop = null;
  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      const x0 = blockMin(i), z0 = blockMin(j), x1 = x0 + BLOCK, z1 = z0 + BLOCK;
      const type = types[i][j];
      blocks.push({ i, j, x0, x1, z0, z1, type });
      slabB.box(x0, x1, 0, CURB, z0, z1, { col: type === 'plaza' ? c3('#f3dcc0') : WHITE, tw: 4, th: 4, topScale: 0.25 });
      for (const t of [6, 32, 58]) {
        lamps.push({ x: x0 + t, z: z0 + 0.7, nx: 0, nz: -1 });
        lamps.push({ x: x0 + t, z: z1 - 0.7, nx: 0, nz: 1 });
        lamps.push({ x: x0 + 0.7, z: z0 + t, nx: -1, nz: 0 });
        lamps.push({ x: x1 - 0.7, z: z0 + t, nx: 1, nz: 0 });
      }
      if (type !== 'park') {
        for (const t of [19, 45]) {
          addTree(x0 + t, z0 + 2, 0.9);
          addTree(x0 + t, z1 - 2, 0.9);
          addTree(x0 + 2, z0 + t, 0.9);
          addTree(x1 - 2, z0 + t, 0.9);
        }
      }
      if (type === 'city') cityBlock(i, j, x0, z0);
      else if (type === 'park') parkBlock(x0, z0);
      else towerTop = plazaBlock(i, j, x0, z0);
    }
  }

  // ---------- roads ----------
  const R = ROAD / 2;
  for (let i = 0; i <= BLOCKS; i++) {
    for (let j = 0; j <= BLOCKS; j++) {
      const x = roadC(i), z = roadC(j);
      interB.top(x - R, x + R, z - R, z + R, 0.02, 1, WHITE, [0, 0, 1, 0, 1, 1, 0, 1]);
      if (j < BLOCKS) {
        // road along z at x, between nodes j and j+1
        const za = z + R, zb = roadC(j + 1) - R;
        roadB.top(x - R, x + R, za, zb, 0.02, 1, WHITE, [0, -zb / 16, 1, -zb / 16, 1, -za / 16, 0, -za / 16]);
        crossB.top(x - R, x + R, za + 0.3, za + 4.3, 0.03, 1, WHITE, [0, 0, 1, 0, 1, 1, 0, 1]);
        crossB.top(x - R, x + R, zb - 4.3, zb - 0.3, 0.03, 1, WHITE, [0, 0, 1, 0, 1, 1, 0, 1]);
      }
      if (i < BLOCKS) {
        // road along x at z, between nodes i and i+1
        const xa = x + R, xb = roadC(i + 1) - R;
        roadB.top(xa, xb, z - R, z + R, 0.02, 1, WHITE, [1, xa / 16, 1, xb / 16, 0, xb / 16, 0, xa / 16]);
        crossB.top(xa + 0.3, xa + 4.3, z - R, z + R, 0.03, 1, WHITE, [1, 0, 1, 1, 0, 1, 0, 0]);
        crossB.top(xb - 4.3, xb - 0.3, z - R, z + R, 0.03, 1, WHITE, [1, 0, 1, 1, 0, 1, 0, 0]);
      }
    }
  }

  // ---------- promenade + seawall ----------
  const E = CITY_EDGE, P = PROMENADE;
  const seaCol = c3('#d9d6ce');
  slabB.box(-E - P, E + P, -3, CURB, -E - P, -E, { col: seaCol, tw: 4, th: 4, topScale: 0.25 });
  slabB.box(-E - P, E + P, -3, CURB, E, E + P, { col: seaCol, tw: 4, th: 4, topScale: 0.25 });
  slabB.box(-E - P, -E, -3, CURB, -E, E, { col: seaCol, tw: 4, th: 4, topScale: 0.25 });
  slabB.box(E, E + P, -3, CURB, -E, E, { col: seaCol, tw: 4, th: 4, topScale: 0.25 });
  const railB = new GeoBuilder();
  const rp = E + P - 0.4;
  railB.box(-rp - 0.1, rp + 0.1, CURB, CURB + 1.1, -rp - 0.1, -rp + 0.1, {});
  railB.box(-rp - 0.1, rp + 0.1, CURB, CURB + 1.1, rp - 0.1, rp + 0.1, {});
  railB.box(-rp - 0.1, -rp + 0.1, CURB, CURB + 1.1, -rp, rp, {});
  railB.box(rp - 0.1, rp + 0.1, CURB, CURB + 1.1, -rp, rp, {});
  for (let s = -E - P + 20; s < E + P - 10; s += 40) {
    const q = E + P - 2.2;
    lamps.push({ x: s, z: -q, nx: 0, nz: 1 }, { x: s, z: q, nx: 0, nz: -1 }, { x: -q, z: s, nx: 1, nz: 0 }, { x: q, z: s, nx: -1, nz: 0 });
    const tq = E + 12;
    if (Math.abs(s) < tq - 4) {
      addTree(s + 20, -tq); addTree(s + 20, tq); addTree(-tq, s + 20); addTree(tq, s + 20);
    }
  }

  // ---------- materials + meshes ----------
  const mats = {};
  for (const s of STYLE_KEYS) {
    const f = T.facade[s];
    mats[s] = new THREE.MeshStandardMaterial({
      map: f.map,
      emissiveMap: f.emissiveMap,
      roughnessMap: f.roughnessMap,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 1,
      metalness: s === 'glass' ? 0.55 : s === 'modern' ? 0.35 : 0.05,
      vertexColors: true,
    });
  }
  const roofMat = new THREE.MeshStandardMaterial({ map: T.roof, vertexColors: true, roughness: 0.95 });
  const sidewalkMat = new THREE.MeshStandardMaterial({ map: T.sidewalk, vertexColors: true, roughness: 0.9 });
  const offset = (m, f) => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
  const pathMat = offset(new THREE.MeshStandardMaterial({ map: T.sidewalk, vertexColors: true, roughness: 0.9 }), -2);
  const grassMat = offset(new THREE.MeshStandardMaterial({ map: T.grass, roughness: 1 }), -1);
  const roadMat = new THREE.MeshStandardMaterial({ map: T.road, roughness: 0.92 });
  const interMat = new THREE.MeshStandardMaterial({ map: T.intersection, roughness: 0.92 });
  const crossMat = offset(new THREE.MeshStandardMaterial({ map: T.crosswalk, roughness: 0.8, alphaTest: 0.5 }), -2);

  const addMesh = (b, m, cast = false) => {
    if (b.empty) return null;
    const mesh = new THREE.Mesh(b.build(), m);
    mesh.receiveShadow = true;
    mesh.castShadow = cast;
    scene.add(mesh);
    return mesh;
  };
  for (const c of chunks.values()) {
    for (const s of STYLE_KEYS) addMesh(c[s], mats[s], true);
    addMesh(c.roof, roofMat, true);
  }
  addMesh(slabB, sidewalkMat);
  addMesh(grassB, grassMat);
  addMesh(pathB, pathMat);
  addMesh(roadB, roadMat);
  addMesh(interB, interMat);
  addMesh(crossB, crossMat);
  addMesh(railB, new THREE.MeshStandardMaterial({ color: 0x40464d, metalness: 0.7, roughness: 0.4 }), true);

  // water
  const seaNormal = T.waterNormal.clone();
  seaNormal.repeat.set(900, 900);
  T.waterNormal.repeat.set(3, 3);
  const waterMat = hazeFog(new THREE.MeshStandardMaterial({
    color: 0x175470, roughness: 0.2, metalness: 0.1, envMapIntensity: 0.55, normalMap: seaNormal, normalScale: new THREE.Vector2(0.22, 0.22),
  }), 0.3);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000), waterMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -1.4;
  scene.add(sea);
  if (ponds.length) {
    const pg = mergeGeometries(ponds.map((p) => new THREE.CircleGeometry(p.r, 28).rotateX(-Math.PI / 2).translate(p.x, CURB + 0.06, p.z)));
    const pondMat = offset(new THREE.MeshStandardMaterial({ color: 0x2a5d6e, roughness: 0.08, metalness: 0.3, normalMap: T.waterNormal, normalScale: new THREE.Vector2(0.2, 0.2) }), -3);
    const pm = new THREE.Mesh(pg, pondMat);
    pm.receiveShadow = true;
    scene.add(pm);
    const rimG = mergeGeometries(ponds.map((p) => new THREE.TorusGeometry(p.r, 0.35, 6, 28).rotateX(-Math.PI / 2).translate(p.x, CURB + 0.08, p.z)));
    scene.add(new THREE.Mesh(rimG, new THREE.MeshStandardMaterial({ color: 0x8a867d, roughness: 0.9 })));
  }

  // ---------- instanced props ----------
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  function instanced(geom, mat, items, place, { cast = false, col } = {}) {
    const m = new THREE.InstancedMesh(geom, mat, items.length);
    items.forEach((it, k) => {
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      place(it, dummy);
      dummy.updateMatrix();
      m.setMatrixAt(k, dummy.matrix);
      if (col) m.setColorAt(k, color.set(col(it)));
    });
    m.castShadow = cast;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    scene.add(m);
    return m;
  }

  // street lamps
  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.09, 0.14, 7, 6).translate(0, 3.5 + CURB, 0),
    new THREE.BoxGeometry(1.9, 0.1, 0.12).translate(0.95, 6.95 + CURB, 0),
  ]);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2f35, metalness: 0.6, roughness: 0.5 });
  const lampPlace = (l, d) => {
    d.position.set(l.x, 0, l.z);
    d.rotation.y = Math.atan2(-l.nz, l.nx);
  };
  instanced(poleGeo, poleMat, lamps, lampPlace, { cast: true });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffd7a0, emissiveIntensity: 0 });
  instanced(new THREE.BoxGeometry(0.75, 0.16, 0.38).translate(1.75, 6.85 + CURB, 0), headMat, lamps, lampPlace);
  const poolMat = new THREE.MeshBasicMaterial({
    map: T.pool, color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pools = instanced(new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2), poolMat, lamps, (l, d) => {
    d.position.set(l.x + l.nx * 1.75, CURB + 0.08, l.z + l.nz * 1.75);
  });
  pools.receiveShadow = false;
  pools.renderOrder = 2;

  // trees
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4231, roughness: 1 });
  instanced(new THREE.CylinderGeometry(0.16, 0.24, 2.8, 6).translate(0, 1.4, 0), trunkMat, trees, (t, d) => {
    d.position.set(t.x, t.y, t.z);
    d.scale.setScalar(t.s);
  }, { cast: true });
  const canopyMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  instanced(new THREE.IcosahedronGeometry(1.7, 1).scale(1, 1.15, 1).translate(0, 3.9, 0), canopyMat, trees, (t, d) => {
    d.position.set(t.x, t.y, t.z);
    d.scale.setScalar(t.s);
    d.rotation.y = t.x * 7.1;
  }, { cast: true, col: (t) => t.col });

  // rooftop clutter
  const clutterMat = new THREE.MeshStandardMaterial({ color: 0x9c9c98, roughness: 0.7, metalness: 0.2 });
  if (roofBoxes.length) {
    instanced(new THREE.BoxGeometry(1, 1, 1), clutterMat, roofBoxes, (b, d) => {
      d.position.set(b.x, b.y, b.z);
      d.scale.set(b.sx, b.sy, b.sz);
    }, { cast: true });
  }
  if (tanks.length) {
    const tankGeo = mergeGeometries([
      new THREE.CylinderGeometry(1, 1, 2.8, 12).translate(0, 2.6, 0),
      new THREE.ConeGeometry(1.12, 1, 12).translate(0, 4.5, 0),
      ...[[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].map(([x, z]) => new THREE.BoxGeometry(0.14, 1.2, 0.14).translate(x, 0.6, z)),
    ]);
    instanced(tankGeo, new THREE.MeshStandardMaterial({ color: 0x6b4c34, roughness: 0.9 }), tanks, (t, d) => {
      d.position.set(t.x, t.y, t.z);
      d.scale.setScalar(t.s);
    }, { cast: true });
  }
  const beaconPts = antennas.map((a) => ({ x: a.x, y: a.y + a.h, z: a.z }));
  if (towerTop) beaconPts.push({ x: towerTop.x, y: towerTop.y, z: towerTop.z, big: true });
  if (antennas.length) {
    instanced(new THREE.CylinderGeometry(0.12, 0.2, 1, 5).translate(0, 0.5, 0), poleMat, antennas, (a, d) => {
      d.position.set(a.x, a.y, a.z);
      d.scale.set(1, a.h, 1);
    });
  }
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false });
  instanced(new THREE.SphereGeometry(0.35, 8, 6), beaconMat, beaconPts, (b, d) => {
    d.position.set(b.x, b.y, b.z);
    d.scale.setScalar(b.big ? 3 : 1);
  });

  // neon signs
  const signMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide });
  if (signs.length) {
    instanced(new THREE.PlaneGeometry(1, 1), signMat, signs, (s, d) => {
      d.position.set(s.x, s.y, s.z);
      d.rotation.y = s.ry;
      d.scale.set(s.w, s.h, 1);
    }, { col: (s) => s.col });
  }

  // ---------- gameplay spots ----------
  const groundY = (x, z) => {
    if (Math.abs(x) > E || Math.abs(z) > E) return CURB;
    const lx = mod(x + HALF, PERIOD), lz = mod(z + HALF, PERIOD);
    return lx >= R && lx < R + BLOCK && lz >= R && lz < R + BLOCK ? CURB : 0;
  };

  const parked = [];
  const used = new Set();
  for (let k = 0; k < 170; k++) {
    const vert = rand() < 0.5;
    const i = ri(0, BLOCKS), j = ri(0, BLOCKS - 1);
    const side = rand() < 0.5 ? 1 : -1;
    const s = rr(8, BLOCK - 8);
    const key = `${vert}|${i}|${j}|${side}|${Math.floor(s / 7)}`;
    if (used.has(key)) continue;
    used.add(key);
    const along = roadC(j) + R + s;
    if (vert) parked.push({ x: roadC(i) + side * PARK_LANE, z: along, heading: side < 0 ? -Math.PI / 2 : Math.PI / 2 });
    else parked.push({ x: along, z: roadC(i) + side * PARK_LANE, heading: side > 0 ? 0 : Math.PI });
  }

  const cores = [];
  const spawn = { x: 4, z: 26 };
  const okCore = (x, z) => cores.every((c) => Math.hypot(c.x - x, c.z - z) > 95) && Math.hypot(x - spawn.x, z - spawn.z) > 45 && !grid.pointInside(x, z, 1.5);
  for (let tries = 0; cores.length < 40 && tries < 8000; tries++) {
    const r = rand();
    let x, z;
    if (r < 0.55) {
      const i = ri(0, BLOCKS), j = ri(0, BLOCKS - 1);
      const along = roadC(j) + R + rr(10, BLOCK - 10), lat = rr(-5, 5);
      if (rand() < 0.5) { x = roadC(i) + lat; z = along; } else { z = roadC(i) + lat; x = along; }
    } else if (r < 0.72 && parks.length) {
      const p = pick(parks);
      const a = rr(-24, 24);
      if (rand() < 0.5) { x = p.cx + a; z = p.cz; } else { x = p.cx; z = p.cz + a; }
    } else if (r < 0.9) {
      const b = pick(blocks);
      const t = rr(8, BLOCK - 8), side = ri(0, 3);
      x = side === 0 ? b.x0 + t : side === 1 ? b.x0 + t : side === 2 ? b.x0 + 2.8 : b.x1 - 2.8;
      z = side === 0 ? b.z0 + 2.8 : side === 1 ? b.z1 - 2.8 : b.z0 + t;
    } else {
      const s = rr(-E, E), q = E + rr(5, P - 5), f = ri(0, 3);
      x = f === 0 ? s : f === 1 ? s : f === 2 ? q : -q;
      z = f === 0 ? q : f === 1 ? -q : s;
    }
    if (okCore(x, z)) cores.push({ x, z, y: groundY(x, z) });
  }

  const api = {
    grid, blocks, buildings, parks, ponds, parked, cores, spawn, groundY, towerTop,
    glow: 0.75, // lit-window brightness at night (a live tweak)
    setNight(n, time) {
      for (const s of STYLE_KEYS) mats[s].emissiveIntensity = n * api.glow;
      headMat.emissiveIntensity = n * 5;
      poolMat.opacity = n * 0.55;
      pools.visible = n > 0.02;
      const blink = (Math.sin(time * 3.2) > 0.2 ? 1 : 0.12) * (0.5 + n * 2.5);
      beaconMat.color.setRGB(blink, blink * 0.1, blink * 0.1);
      signMat.color.setScalar(0.75 + n * 1.6);
      T.waterNormal.offset.set(time * 0.02, time * 0.012);
      seaNormal.offset.set(time * 0.004, time * 0.0025);
    },
  };
  return api;
}
