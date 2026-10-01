import * as THREE from 'three';
import { smoothstep, GeoBuilder } from '../../engine/index.js';
import { terrainY, lotAt, fbm, GX0, GZ0, CELL, NI, NJ, FADE, FOOT_Z, SHORE_Z, KOWLOON_Z, PEAK } from './layout.js';

// Fine spacing where the city is, coarser toward the horizon.
function axis(lo, hi, fineLo, fineHi, step = 4) {
  const a = [];
  let v = fineLo;
  while (v > lo) {
    a.unshift(v);
    v -= Math.min(90, step + (fineLo - v) * 0.07);
  }
  a.unshift(lo);
  for (v = fineLo + step; v < fineHi; v += step) a.push(v);
  v = fineHi;
  while (v < hi) {
    a.push(v);
    v += Math.min(90, step + (v - fineHi) * 0.07);
  }
  a.push(hi);
  return a;
}

const C = (h) => new THREE.Color(h);
const ASPHALT = C('#1a1b20'), PAVING = C('#34353a'), SHOTCRETE = C('#77766e'), SHOTCRETE2 = C('#5f5e58');
const JUNGLE = C('#1d3321'), JUNGLE2 = C('#2c4a2a'), ROCK = C('#4b4740'), SILT = C('#15201f'), KOWLOON = C('#2a2b30');

export function buildTerrain(scene, T) {
  const ax = axis(-2800, 2800, -840, 840);
  const az = axis(-2800, 1600, -300, 720);
  const nx = ax.length, nz = az.length;
  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  const meta = new Uint8Array(nx * nz); // 0 natural, 1 street, 2 pad, 3 retaining slope, 4 plaza
  let k = 0;
  for (let j = 0; j < nz; j++) {
    const z = az[j];
    for (let i = 0; i < nx; i++, k++) {
      const x = ax[i];
      pos[k * 3] = x;
      pos[k * 3 + 1] = terrainY(x, z);
      pos[k * 3 + 2] = z;
      uv[k * 2] = x / 6;
      uv[k * 2 + 1] = z / 6;
      const ci = Math.floor((x - GX0) / CELL), cj = Math.floor((z - GZ0) / CELL);
      if (Math.hypot(x - PEAK.x, z - PEAK.z) < PEAK.r) meta[k] = 4;
      else if (ci >= 0 && ci < NI && cj >= 0 && cj < NJ) {
        const L = lotAt(ci, cj);
        const dx = Math.max(L.x0 - x, 0, x - L.x1), dz = Math.max(L.z0 - z, 0, z - L.z1);
        const d = Math.hypot(dx, dz);
        if (L.zone === 'downtown') meta[k] = d > 0 ? 1 : 2;
        else if (L.zone === 'hill' && L.built) meta[k] = d === 0 ? (L.pad ? 2 : 0) : L.pad && d < FADE ? 3 : 1;
        else if (L.zone === 'hill') meta[k] = d > 0 && (dx > 3.5 || dz > 3.5) ? 1 : 0;
      } else if (z > SHORE_Z && z < FOOT_Z && Math.abs(x) < 900) meta[k] = 1;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
      idx[q++] = a; idx[q++] = d; idx[q++] = b;
      idx[q++] = b; idx[q++] = d; idx[q++] = e;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();

  const nrm = g.attributes.normal;
  const col = new Float32Array(nx * nz * 3);
  const c = new THREE.Color();
  for (k = 0; k < nx * nz; k++) {
    const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
    const up = nrm.getY(k);
    const m = meta[k];
    const wob = fbm(x / 40, z / 40, 2) * 0.5 + 0.5;
    if (y < 0.5) c.copy(SILT);
    else if (z < KOWLOON_Z) c.copy(KOWLOON).lerp(JUNGLE, smoothstep(20, 80, y));
    else if (m === 1) c.copy(ASPHALT).lerp(SHOTCRETE2, up < 0.75 ? 0.6 : 0);
    else if (m === 2 || m === 4) c.copy(PAVING).lerp(ASPHALT, wob * 0.5);
    else if (m === 3) c.copy(SHOTCRETE).lerp(SHOTCRETE2, wob);
    else {
      c.copy(JUNGLE).lerp(JUNGLE2, wob);
      c.lerp(ROCK, smoothstep(0.7, 0.45, up));
      if (z < FOOT_Z + 4 && z > SHORE_Z) c.copy(PAVING);
    }
    col[k * 3] = c.r;
    col[k * 3 + 1] = c.g;
    col[k * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();

  T.detail.repeat.set(1, 1);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: T.detail, roughness: 0.82, metalness: 0.05 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { mesh, mat };
}

// Fake neon reflections: streaks on the harbour below the waterfront towers on both shores.
export function buildReflections(scene, T, buildings, rng) {
  const b = new GeoBuilder();
  const cols = ['#ff3cac', '#05d9e8', '#ffd99a', '#b967ff', '#ffb35a', '#7df9ff', '#ff8b3d'].map((h) => new THREE.Color(h));
  for (const t of buildings) {
    const island = t.z0 < GZ0 + 44 && t.zone === 'downtown';
    const kowloon = t.zone === 'kowloon' && t.z1 > KOWLOON_Z - 80;
    if (!island && !kowloon) continue;
    const c = rng.pick(cols).clone().multiplyScalar(rng.rr(0.5, 1));
    const len = Math.min(320, (t.h - t.base) * rng.rr(1.1, 1.8));
    const w = (t.x1 - t.x0) * rng.rr(0.5, 0.9), cx = (t.x0 + t.x1) / 2;
    if (island) b.top(cx - w / 2, cx + w / 2, SHORE_Z - 2 - len, SHORE_Z - 2, 0.05, 1, [c.r, c.g, c.b], [0, 1, 1, 1, 1, 0, 0, 0]);
    else b.top(cx - w / 2, cx + w / 2, KOWLOON_Z + 2, KOWLOON_Z + 2 + len * 0.7, 0.05, 1, [c.r, c.g, c.b], [0, 0, 1, 0, 1, 1, 0, 1]);
  }
  const mat = new THREE.MeshBasicMaterial({ map: T.streak, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(b.build(), mat);
  mesh.renderOrder = 2;
  scene.add(mesh);
  return { mesh, mat };
}

export function buildWater(scene, normalTex) {
  normalTex.repeat.set(700, 700);
  const mat = new THREE.MeshStandardMaterial({
    color: '#0b1c26', roughness: 0.06, metalness: 0.7, normalMap: normalTex, normalScale: new THREE.Vector2(0.35, 0.35),
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { mesh, mat, tex: normalTex };
}
