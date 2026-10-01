import * as THREE from 'three';
import { smoothstep } from '../../engine/index.js';
import { terrainY, insideWalls, distToWall, roadClear, riverX, RIVER_W, shoreZ } from './layout.js';

// One terrain mesh: 3 m vertex spacing across the city, growing coarser toward the horizon.
function axis() {
  const a = [0];
  let c = 0;
  while (c < 2700) {
    c += c < 480 ? 3 : Math.min(70, 3 + (c - 480) * 0.06);
    a.push(c);
  }
  return a.slice(1).map((v) => -v).reverse().concat(a);
}

const C = (h) => new THREE.Color(h);
const DIRT = C('#9a8a70'), DIRT2 = C('#85775f'), GRASS = C('#6c7a43'), GRASS2 = C('#56663a'), SAND = C('#c9b892'), MUD = C('#6f6552'), DEEP = C('#3e4c47');
const FIELDS = ['#7f8d48', '#a39c58', '#b8a865', '#667a3c', '#8e924c', '#9c8a55'].map(C);

export function buildTerrain(scene, T) {
  const ax = axis();
  const n = ax.length;
  const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  const c = new THREE.Color();
  let k = 0;
  for (let j = 0; j < n; j++) {
    const z = ax[j];
    for (let i = 0; i < n; i++, k++) {
      const x = ax[i];
      const y = terrainY(x, z);
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      uv[k * 2] = x / 5;
      uv[k * 2 + 1] = z / 5;
      const r = Math.max(Math.abs(x), Math.abs(z));
      const wob = Math.sin(x / 7.3) * Math.cos(z / 5.1) * 0.5 + 0.5;
      if (r < 360 && insideWalls(x, z)) {
        c.copy(DIRT).lerp(DIRT2, wob * 0.7);
        if (roadClear(x, z, 6) < 4) c.lerp(DIRT2, 0.5);
      } else {
        const fi = Math.floor(x / 70), fj = Math.floor(z / 46);
        const h = Math.abs(Math.sin(fi * 127.1 + fj * 311.7) * 43758.5453) % 1;
        c.copy(GRASS).lerp(GRASS2, wob);
        const dr = Math.hypot(x, z);
        if (dr > 380 && dr < 1500 && z < 150 && h < 0.7) c.lerp(FIELDS[Math.floor(h * 60) % FIELDS.length], 0.85 * smoothstep(1500, 1100, dr));
        if (r < 400) c.lerp(DIRT2, smoothstep(26, 8, distToWall(x, z)) * 0.8);
        if (r < 1400 && roadClear(x, z, 10) < 3) c.lerp(DIRT, 0.6);
      }
      const dR = Math.abs(x - riverX(z));
      if (dR < RIVER_W + 22) c.lerp(MUD, smoothstep(RIVER_W + 22, RIVER_W, dR));
      if (z > shoreZ(x) - 30) c.lerp(SAND, smoothstep(3.2, 1.5, y));
      if (y < 0) c.lerp(DEEP, smoothstep(0, -7, y));
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let q = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
      idx[q++] = a; idx[q++] = d; idx[q++] = b;
      idx[q++] = b; idx[q++] = d; idx[q++] = e;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: T.detail, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { mesh, mat };
}

export function buildWater(scene, normalTex) {
  normalTex.repeat.set(900, 900);
  const mat = new THREE.MeshStandardMaterial({
    color: '#2b5764', roughness: 0.12, metalness: 0.35, normalMap: normalTex, normalScale: new THREE.Vector2(0.55, 0.55),
    transparent: true, opacity: 0.9,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { mesh, mat, tex: normalTex };
}
