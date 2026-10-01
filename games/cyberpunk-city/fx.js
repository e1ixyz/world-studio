import * as THREE from 'three';
import { createRng } from '../../engine/index.js';

// Rain streaks in a box that follows the camera.
export class Rain {
  constructor(scene, count = 5000) {
    const R = createRng('rain');
    this.n = count;
    this.box = { w: 130, h: 70 };
    this.drops = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.drops.set([R.rr(-65, 65), R.rr(0, 70), R.rr(-65, 65)], i * 3);
    this.speed = new Float32Array(count).map(() => R.rr(34, 46));
    this.pos = new Float32Array(count * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.LineBasicMaterial({ color: '#9fb6d8', transparent: true, opacity: 0.35, depthWrite: false, fog: true });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.amount = 1;
    this.len = 1.4;
  }

  update(dt, cam) {
    const on = this.amount > 0.01;
    this.lines.visible = on;
    if (!on) return;
    const d = this.drops, p = this.pos, { w, h } = this.box;
    const active = Math.floor(this.n * Math.min(1, this.amount));
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    const wind = 3;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3, q = i * 6;
      if (i >= active) {
        p[q + 1] = p[q + 4] = -1e4;
        continue;
      }
      d[k + 1] -= this.speed[i] * dt;
      d[k] += wind * dt;
      if (d[k + 1] < 0) d[k + 1] += h;
      if (d[k] > w / 2) d[k] -= w;
      // wrap drops around the camera so the box never visibly slides
      const x = cx + ((((d[k] - cx) % w) + w * 1.5) % w) - w / 2;
      const z = cz + ((((d[k + 2] - cz) % w) + w * 1.5) % w) - w / 2;
      const y = cy - h / 2 + d[k + 1];
      p[q] = x; p[q + 1] = y; p[q + 2] = z;
      p[q + 3] = x - wind * 0.03; p[q + 4] = y + this.len; p[q + 5] = z;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}

// Glowing data shards with beams you can spot across the city.
export class Shards {
  constructor(scene, spots, T) {
    this.items = [];
    const gem = new THREE.OctahedronGeometry(0.8, 0).scale(0.7, 1.4, 0.7);
    const ring = new THREE.TorusGeometry(1.3, 0.06, 6, 32);
    const beam = new THREE.CylinderGeometry(0.5, 0.5, 120, 12, 1, true).translate(0, 60, 0);
    const pool = new THREE.PlaneGeometry(7, 7).rotateX(-Math.PI / 2);
    this.gemMat = new THREE.MeshStandardMaterial({ color: 0x300818, emissive: 0xff3cac, emissiveIntensity: 2.4, metalness: 0.3, roughness: 0.2 });
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffb3e0 });
    this.beamMat = new THREE.MeshBasicMaterial({ map: T.beam, color: 0xff3cac, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const poolMat = new THREE.MeshBasicMaterial({ map: T.pool, color: 0xff3cac, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    spots.forEach((s, i) => {
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      const m = new THREE.Mesh(gem, this.gemMat);
      m.position.y = 1.6;
      const r = new THREE.Mesh(ring, this.ringMat);
      r.position.y = 1.6;
      const p = new THREE.Mesh(pool, poolMat);
      p.position.y = 0.08;
      p.renderOrder = 3;
      g.add(m, r, new THREE.Mesh(beam, this.beamMat), p);
      scene.add(g);
      this.items.push({ ...s, i, g, m, r, got: false, ph: i * 1.7 });
    });
    this.total = this.items.length;
    this.count = 0;
  }

  take(it) {
    if (it.got) return;
    it.got = true;
    it.g.visible = false;
    this.count++;
  }

  update(dt, t, px, py, pz, onCollect) {
    for (const it of this.items) {
      if (it.got) continue;
      it.m.rotation.y += dt * 1.8;
      it.m.position.y = 1.6 + Math.sin(t * 2 + it.ph) * 0.25;
      it.r.position.y = it.m.position.y;
      it.r.rotation.x = t * 1.1 + it.ph;
      it.r.rotation.y = t * 0.7;
      if (Math.abs(py - it.y - 1) < 3.5 && Math.hypot(it.x - px, it.z - pz) < 2.6) {
        this.take(it);
        onCollect(it);
      }
    }
  }
}
