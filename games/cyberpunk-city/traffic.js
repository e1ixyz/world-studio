import * as THREE from 'three';
import { GeoBuilder, createRng, smoothstep } from '../../engine/index.js';
import { natural, GX0, GZ0, CELL, PIER, KOWLOON_Z } from './layout.js';
import { rgb } from './city.js';

const BODY_COLORS = ['#1b1d22', '#2a2d34', '#d8d8dc', '#6a0f1e', '#0f2a4a', '#c9a227', '#3a0f4a', '#101010', '#8a8f98'];

// Hover cars streaming along air lanes above the streets and across the harbour.
export class SkyTraffic {
  constructor(scene) {
    const R = createRng('sky-traffic-v1');
    const body = new GeoBuilder();
    body.box(-2.3, 2.3, 0, 0.9, -1.05, 1.05);
    body.box(-1.1, 1.3, 0.9, 1.55, -0.85, 0.85);
    body.box(-2.6, -1.6, 0.1, 0.7, -1.4, 1.4); // rear thrusters
    const glow = new GeoBuilder();
    const W = rgb('#ffffff'), RED = rgb('#ff2030');
    glow.box(2.3, 2.4, 0.4, 0.65, -0.95, -0.45, { col: W });
    glow.box(2.3, 2.4, 0.4, 0.65, 0.45, 0.95, { col: W });
    glow.box(-2.7, -2.6, 0.2, 0.6, -1.35, 1.35, { col: RED });
    glow.box(-1.8, 1.8, -0.12, 0, -0.6, 0.6, { col: rgb('#05d9e8') }); // underglow
    this.lanes = [];
    const lane = (axis, c, y, dir, lo, hi, speed, follow = false) => this.lanes.push({ axis, c, y, dir, lo, hi, speed, follow });
    // Central: along the east-west streets, two heights each way
    for (let j = 0; j <= 4; j++) {
      const z = GZ0 + j * CELL;
      lane('x', z - 2, R.rr(28, 45), 1, -950, 950, R.rr(26, 34));
      lane('x', z + 2, R.rr(55, 80), -1, -950, 950, R.rr(28, 38));
      lane('x', z, R.rr(100, 140), j % 2 ? 1 : -1, -950, 950, R.rr(34, 46));
    }
    // across the harbour between Kowloon and the island
    for (const i of [3, 6, 9, 12, 21, 24, 27]) {
      const x = GX0 + i * CELL;
      lane('z', x - 2, R.rr(60, 90), 1, -1500, -60, R.rr(30, 42));
      lane('z', x + 2, R.rr(95, 125), -1, -1500, -60, R.rr(30, 42));
    }
    // low over the water
    for (const z of [-300, -430, -560, -700, -800]) lane('x', z, R.rr(18, 40), R.rand() < 0.5 ? 1 : -1, -1400, 1400, R.rr(30, 50));
    // Mid-Levels: hugging the slope above the contour streets
    for (const j of [5, 6, 7, 8, 9, 10]) lane('x', GZ0 + j * CELL, R.rr(22, 40), j % 2 ? 1 : -1, -800, 800, R.rr(20, 28), true);

    this.cars = [];
    for (const L of this.lanes) {
      for (let s = L.lo + R.rr(0, 60); s < L.hi; s += R.rr(30, 110)) this.cars.push({ L, s, ph: R.rr(0, 6.28), bob: R.rr(0.3, 1), col: R.pick(BODY_COLORS), x: 0, y: 0, z: 0 });
    }
    const n = this.cars.length;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.8, roughness: 0.3 });
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.body = new THREE.InstancedMesh(body.build(), this.bodyMat, n);
    this.glow = new THREE.InstancedMesh(glow.build(), this.glowMat, n);
    const c = new THREE.Color();
    this.cars.forEach((car, i) => this.body.setColorAt(i, c.set(car.col)));
    for (const m of [this.body, this.glow]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
    }
    this.body.castShadow = true;
    this.speedScale = 1;
    this.dummy = new THREE.Object3D();
    this.update(0, 0);
  }

  update(dt, t) {
    const d = this.dummy;
    this.cars.forEach((car, i) => {
      const L = car.L;
      car.s += L.dir * L.speed * this.speedScale * dt;
      const span = L.hi - L.lo;
      if (car.s > L.hi) car.s -= span;
      else if (car.s < L.lo) car.s += span;
      const x = L.axis === 'x' ? car.s : L.c, z = L.axis === 'x' ? L.c : car.s;
      const y = (L.follow ? natural(x, z) : 0) + L.y + Math.sin(t * car.bob + car.ph) * 0.6;
      car.x = x; car.y = y; car.z = z;
      d.position.set(x, y, z);
      d.rotation.set(0, L.axis === 'x' ? (L.dir > 0 ? 0 : Math.PI) : L.dir > 0 ? -Math.PI / 2 : Math.PI / 2, Math.sin(t * 0.7 + car.ph) * 0.05);
      d.updateMatrix();
      this.body.setMatrixAt(i, d.matrix);
      this.glow.setMatrixAt(i, d.matrix);
    });
    this.body.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
  }

  setNight(n) {
    this.glowMat.color.setScalar(0.8 + n * 2.6);
  }
}

// Star Ferries shuttling across the harbour, and junks with red sails drifting past.
export class Harbour {
  constructor(scene) {
    const R = createRng('harbour-v1');
    this.boats = [];
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.7, ...o });
    const green = std({ color: '#1e5a3a' }), white = std({ color: '#e8e8e2' }), dark = std({ color: '#2a1d14' });
    this.winMat = std({ color: '#111', emissive: '#fff1c8', emissiveIntensity: 1 });
    this.sailMat = std({ color: '#b3261e', emissive: '#ff3a20', emissiveIntensity: 0.2, side: THREE.DoubleSide });
    this.lanternMat = new THREE.MeshBasicMaterial({ color: '#ffb040' });
    const box = (w, h, d, m, y) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.y = y;
      mesh.castShadow = true;
      return mesh;
    };
    for (let k = 0; k < 2; k++) {
      const g = new THREE.Group();
      g.add(box(9, 2.6, 28, green, 0.3), box(8, 2.6, 22, white, 2.9), box(8.2, 1, 20, this.winMat, 3.1), box(6.6, 2.2, 14, green, 5.3), box(6.8, 0.8, 12, this.winMat, 5.4));
      scene.add(g);
      this.boats.push({ kind: 'Star Ferry', id: `ferry ${k + 1}`, g, x: (PIER.x0 + PIER.x1) / 2, z: 0, y: 0, ferry: true, p: k * 0.5, dir: k ? -1 : 1, wait: k ? 0 : 6 });
    }
    const sail = new THREE.Shape();
    sail.moveTo(0, 0);
    sail.lineTo(0, 11);
    sail.quadraticCurveTo(5, 10, 7.5, 7);
    sail.lineTo(6, 0);
    const sailGeo = new THREE.ShapeGeometry(sail);
    for (let k = 0; k < 3; k++) {
      const g = new THREE.Group();
      g.add(box(5, 1.8, 16, dark, 0.4), box(4, 1.4, 5, dark, 1.9));
      for (const [z, s] of [[-4.5, 0.8], [1.5, 1], [6, 0.6]]) {
        const m = new THREE.Mesh(sailGeo, this.sailMat);
        m.scale.setScalar(s);
        m.position.set(0, 1.3, z);
        m.rotation.y = -Math.PI / 2 + 0.25;
        g.add(m);
      }
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), this.lanternMat);
      lantern.position.set(0, 3, -7.5);
      g.add(lantern);
      g.rotation.y = Math.PI / 2;
      scene.add(g);
      this.boats.push({ kind: 'junk', id: `junk ${k + 1}`, g, x: R.rr(-1100, 1100), z: -470 - k * 120, y: 0, sp: R.rr(3, 5) * (k % 2 ? -1 : 1) });
    }
    this.dock = { a: PIER.z0 - 16, b: KOWLOON_Z + 64 };
  }

  update(dt, t) {
    for (const b of this.boats) {
      if (b.ferry) {
        if (b.wait > 0) b.wait -= dt;
        else {
          b.p += (b.dir * dt) / 70;
          if (b.p >= 1 || b.p <= 0) {
            b.p = Math.min(1, Math.max(0, b.p));
            b.dir *= -1;
            b.wait = 12;
          }
        }
        const e = smoothstep(0, 1, b.p);
        b.z = this.dock.a + (this.dock.b - this.dock.a) * e;
        b.g.position.set(b.x, Math.sin(t * 0.9 + b.p * 9) * 0.15, b.z);
        b.g.rotation.z = Math.sin(t * 0.7 + b.x) * 0.012;
      } else {
        b.x += b.sp * dt;
        if (b.x > 1300) b.x = -1300;
        if (b.x < -1300) b.x = 1300;
        b.g.position.set(b.x, Math.sin(t * 1.1 + b.z) * 0.2, b.z);
        b.g.rotation.y = b.sp > 0 ? Math.PI / 2 : -Math.PI / 2;
        b.g.rotation.x = Math.sin(t * 0.8 + b.z) * 0.02;
      }
    }
  }

  setNight(n) {
    this.winMat.emissiveIntensity = 0.1 + n * 1.4;
    this.sailMat.emissiveIntensity = 0.05 + n * 0.35;
    this.lanternMat.color.set('#ffb040').multiplyScalar(0.6 + n * 2);
  }
}
