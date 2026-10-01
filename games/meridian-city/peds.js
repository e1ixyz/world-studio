import * as THREE from 'three';
import { rand, rr, pick } from './rng.js';
import { CURB, HALF } from './config.js';

const SHIRTS = ['#c0392b', '#2c3e50', '#ecf0f1', '#f39c12', '#27ae60', '#2980b9', '#8e44ad', '#34495e', '#d35400', '#16a085', '#7f8c8d', '#e84393', '#1e272e', '#f5f6fa'];
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a0673c'];

// Pedestrians loop around block sidewalks.
export class Peds {
  constructor(scene, blocks, count) {
    this.list = [];
    this.speedScale = 1; // live tweak
    while (this.list.length < count) {
      const b = pick(blocks);
      const d = Math.hypot((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) / HALF;
      if (rand() > 1.1 - d * 0.8) continue; // denser downtown
      const inset = rr(2.6, 3.4);
      const x0 = b.x0 + inset, z0 = b.z0 + inset;
      const w = b.x1 - b.x0 - inset * 2, h = b.z1 - b.z0 - inset * 2;
      const L = 2 * (w + h);
      this.list.push({ x0, z0, w, h, L, t: rand() * L, sp: rr(1.0, 1.7) * (rand() < 0.5 ? -1 : 1), ph: rand() * 10, s: rr(0.9, 1.08), x: 0, z: 0 });
    }
    const n = this.list.length;
    const body = new THREE.CylinderGeometry(0.21, 0.15, 1.32, 7).translate(0, 0.66, 0);
    const head = new THREE.SphereGeometry(0.13, 8, 6).translate(0, 1.48, 0);
    this.body = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.8 }), n);
    this.head = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ roughness: 0.7 }), n);
    const c = new THREE.Color();
    this.list.forEach((p, k) => {
      this.body.setColorAt(k, c.set(pick(SHIRTS)));
      this.head.setColorAt(k, c.set(pick(SKIN)));
    });
    for (const m of [this.body, this.head]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this.body.castShadow = true;
    this.d = new THREE.Object3D();
  }

  update(dt, time) {
    const d = this.d;
    this.list.forEach((p, k) => {
      p.t = (((p.t + p.sp * dt * this.speedScale) % p.L) + p.L) % p.L;
      let t = p.t, x, z, dx, dz;
      if (t < p.w) { x = p.x0 + t; z = p.z0; dx = 1; dz = 0; }
      else if ((t -= p.w) < p.h) { x = p.x0 + p.w; z = p.z0 + t; dx = 0; dz = 1; }
      else if ((t -= p.h) < p.w) { x = p.x0 + p.w - t; z = p.z0 + p.h; dx = -1; dz = 0; }
      else { t -= p.w; x = p.x0; z = p.z0 + p.h - t; dx = 0; dz = -1; }
      if (p.sp < 0) { dx = -dx; dz = -dz; }
      p.x = x;
      p.z = z;
      const cyc = time * Math.abs(p.sp) * 5.5 + p.ph;
      d.position.set(x, CURB + Math.abs(Math.sin(cyc)) * 0.06, z);
      d.rotation.set(0, Math.atan2(dx, dz), Math.sin(cyc) * 0.05);
      d.scale.setScalar(p.s);
      d.updateMatrix();
      this.body.setMatrixAt(k, d.matrix);
      this.head.setMatrixAt(k, d.matrix);
    });
    this.body.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
  }
}
