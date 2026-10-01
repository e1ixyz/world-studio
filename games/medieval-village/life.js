import * as THREE from 'three';
import { createRng } from '../../engine/index.js';
import { groundY, insideWalls, ROADS, GATES, KEEP } from './layout.js';

const R = createRng('kings-landing-life');
const { rand, rr, pick } = R;

const CLOAKS = ['#6b4f3a', '#7d6b52', '#4f5a3f', '#8a7a5c', '#5c3b2e', '#6e6e5e', '#8c3b2b', '#3e4a5c', '#9b8b6e', '#5a4a6a', '#a0886a'];
const SKIN = ['#e8c39e', '#d9a877', '#c68642', '#8d5524', '#f1d0b0', '#a0673c'];
const GOLD_CLOAK = '#c9a232';

// Smallfolk walking the streets, and gold cloaks standing guard at the gates.
export class Folk {
  constructor(scene, count = 320) {
    this.speedScale = 1;
    this.list = [];
    const roads = ROADS.filter((r) => r.pts.some(([x, z]) => insideWalls(x, z)));
    const total = roads.reduce((s, r) => s + r.len, 0);
    for (let i = 0; i < count; i++) {
      let pickLen = rand() * total, road = roads[0];
      for (const r of roads) if ((pickLen -= r.len) <= 0) { road = r; break; }
      const guard = rand() < 0.08;
      this.list.push({
        road, s: rand() * road.len, v: rr(0.9, 1.5), dir: rand() < 0.5 ? 1 : -1, off: rr(-road.w / 2 + 0.7, road.w / 2 - 0.7),
        ph: rand() * 10, sc: rr(0.9, 1.08), guard, x: 0, z: 0, y: 0, still: false,
      });
    }
    for (const g of GATES) {
      for (const s of [-1, 1]) {
        const x = g.x + g.dx * 4 * s - g.nx * 5, z = g.z + g.dz * 4 * s - g.nz * 5;
        this.list.push({ still: true, x, z, y: groundY(x, z), yaw: Math.atan2(g.nx, g.nz), guard: true, ph: rand() * 10, sc: 1.05 });
      }
    }
    for (const s of [-1, 1]) for (const k of [0, 1]) {
      const x = KEEP.gate[0] + s * 4.5, z = KEEP.gate[1] + 3 + k * 5;
      this.list.push({ still: true, x, z, y: groundY(x, z), yaw: Math.PI, guard: true, ph: rand() * 10, sc: 1.05 });
    }
    const n = this.list.length;
    const body = new THREE.CylinderGeometry(0.2, 0.36, 1.4, 8).translate(0, 0.7, 0);
    const head = new THREE.SphereGeometry(0.14, 10, 8).translate(0, 1.55, 0);
    this.body = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.9 }), n);
    this.head = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ roughness: 0.7 }), n);
    const c = new THREE.Color();
    this.list.forEach((p, k) => {
      this.body.setColorAt(k, c.set(p.guard ? GOLD_CLOAK : pick(CLOAKS)));
      this.head.setColorAt(k, p.guard ? c.set('#9a9a9e') : c.set(pick(SKIN)));
    });
    for (const m of [this.body, this.head]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      scene.add(m);
    }
    this.o = new THREE.Object3D();
  }

  update(dt, t) {
    const o = this.o;
    this.list.forEach((p, k) => {
      let bob = 0, yaw = p.yaw || 0;
      if (!p.still) {
        const r = p.road;
        p.s += p.v * p.dir * dt * this.speedScale;
        if (p.s < 0 || p.s > r.len) {
          p.dir = -p.dir;
          p.s = Math.max(0, Math.min(r.len, p.s));
        }
        const f = p.s / r.step, i = Math.min(r.pts.length - 2, Math.floor(f)), u = f - i;
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
        let tx = bx - ax, tz = bz - az;
        const l = Math.hypot(tx, tz) || 1;
        tx /= l; tz /= l;
        p.x = ax + (bx - ax) * u - tz * p.off;
        p.z = az + (bz - az) * u + tx * p.off;
        p.y = groundY(p.x, p.z);
        yaw = Math.atan2(tx * p.dir, tz * p.dir);
        const cyc = t * p.v * 5.5 * this.speedScale + p.ph;
        bob = Math.abs(Math.sin(cyc)) * 0.06;
        o.rotation.set(0, yaw, Math.sin(cyc) * 0.05);
      } else o.rotation.set(0, yaw + Math.sin(t * 0.3 + p.ph) * 0.3, 0);
      o.position.set(p.x, p.y + 0.12 + bob, p.z);
      o.scale.setScalar(p.sc);
      o.updateMatrix();
      this.body.setMatrixAt(k, o.matrix);
      this.head.setMatrixAt(k, o.matrix);
    });
    this.body.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
  }
}

// A great black dragon circling the city.
export class Dragon {
  constructor(scene) {
    this.speed = 1;
    this.alt = 115;
    this.radius = 330;
    this.center = new THREE.Vector3(40, 0, -40);
    this.a = 0;
    this.pos = new THREE.Vector3();
    this.bodyMat = new THREE.MeshStandardMaterial({ color: '#221715', roughness: 0.55, metalness: 0.15 });
    this.wingMat = new THREE.MeshStandardMaterial({ color: '#3b1f1a', roughness: 0.75, side: THREE.DoubleSide });
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#ff8a1a' });
    const root = new THREE.Group();
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      root.add(m);
      return m;
    };
    add(new THREE.SphereGeometry(1, 16, 12).scale(2.4, 2.1, 5.8), this.bodyMat, 0, 0, 0);
    add(new THREE.CylinderGeometry(0.9, 1.5, 7.5, 10).rotateX(Math.PI / 2 - 0.35), this.bodyMat, 0, 1.2, 7.4);
    add(new THREE.BoxGeometry(1.7, 1.3, 3.4), this.bodyMat, 0, 2.5, 11.8);
    add(new THREE.BoxGeometry(1.3, 0.5, 2.6), this.bodyMat, 0, 1.8, 12.4);
    for (const s of [-1, 1]) {
      add(new THREE.ConeGeometry(0.28, 2.4, 6).rotateX(-Math.PI / 2 + 0.5), this.bodyMat, s * 0.6, 3.4, 10.2);
      add(new THREE.SphereGeometry(0.16, 6, 4), eyeMat, s * 0.78, 2.8, 12.6);
      add(new THREE.ConeGeometry(0.5, 3, 6).rotateX(-Math.PI / 2 - 0.6), this.bodyMat, s * 1.4, -1.8, -2.5);
    }
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0, -4.5);
    const tailM = new THREE.Mesh(new THREE.ConeGeometry(1.4, 18, 10).rotateX(-Math.PI / 2).translate(0, 0, -9), this.bodyMat);
    tailM.castShadow = true;
    this.tail.add(tailM);
    root.add(this.tail);
    // wing membrane: shoulder, elbow, tip and finger points
    const P = [[0, 0, 2.6], [0, 0, -3.2], [9, 1.6, 3.6], [23, 2.4, -1], [16, 0.6, -8.5], [7.5, 0, -7.5]];
    const T = [[0, 2, 1], [1, 2, 5], [2, 4, 5], [2, 3, 4]];
    const wingGeo = (m) => {
      const g = new THREE.BufferGeometry();
      const pos = [];
      for (const tri of T) for (const i of m < 0 ? [tri[0], tri[2], tri[1]] : tri) pos.push(P[i][0] * m, P[i][1], P[i][2]);
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return g;
    };
    this.wings = [1, -1].map((m) => {
      const pivot = new THREE.Group();
      pivot.position.set(m * 1.7, 1, 1.5);
      const w = new THREE.Mesh(wingGeo(m), this.wingMat);
      w.castShadow = true;
      pivot.add(w);
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 1, 6), this.bodyMat);
      const a = new THREE.Vector3(0, 0, 2.6), b = new THREE.Vector3(9 * m, 1.6, 3.6), c = new THREE.Vector3(23 * m, 2.4, -1);
      for (const [p, q] of [[a, b], [b, c]]) {
        const bm = bone.clone();
        bm.scale.y = p.distanceTo(q);
        bm.position.copy(p).add(q).multiplyScalar(0.5);
        bm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize());
        pivot.add(bm);
      }
      root.add(pivot);
      return { pivot, m };
    });
    this.root = root;
    this.group = new THREE.Group();
    this.group.add(root);
    scene.add(this.group);
    this.scale = 1;
    this.bank = 0;
  }

  update(dt, t) {
    const v = 30 * this.speed;
    this.a += (v * dt) / this.radius;
    const a = this.a, c = this.center;
    const x = c.x + Math.cos(a) * this.radius, z = c.z + Math.sin(a) * this.radius * 0.82;
    const y = this.alt + Math.sin(a * 2.3) * 22;
    const nx = c.x + Math.cos(a + 0.02) * this.radius, nz = c.z + Math.sin(a + 0.02) * this.radius * 0.82, ny = this.alt + Math.sin((a + 0.02) * 2.3) * 22;
    this.pos.set(x, y, z);
    this.group.position.copy(this.pos);
    this.group.lookAt(nx, ny, nz);
    this.bank += (0.45 - this.bank) * (1 - Math.exp(-dt));
    this.root.rotation.z = this.bank * Math.sign(this.speed || 1);
    this.root.scale.setScalar(this.scale);
    const glide = 0.5 + 0.5 * Math.sin(t * 0.25);
    const flap = Math.sin(t * 2.4) * (0.15 + 0.5 * glide) + 0.08;
    for (const w of this.wings) w.pivot.rotation.z = flap * w.m;
    this.tail.rotation.y = Math.sin(t * 0.9) * 0.18;
    this.tail.rotation.x = Math.sin(t * 1.3) * 0.06;
  }
}

// Gold dragons (coins) hidden around the city.
export class Coins {
  constructor(scene, spots, beamTex) {
    this.items = [];
    this.count = 0;
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 24).rotateX(Math.PI / 2);
    this.mat = new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 0.85, roughness: 0.28, emissive: '#7a5200', emissiveIntensity: 0.6 });
    this.beamMat = new THREE.MeshBasicMaterial({ map: beamTex, color: '#ffcf5a', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beamG = new THREE.PlaneGeometry(1.4, 28).translate(0, 14, 0);
    for (const s of spots) {
      const g = new THREE.Group();
      const coin = new THREE.Mesh(geo, this.mat);
      coin.position.y = 1.2;
      g.add(coin);
      for (const r of [0, Math.PI / 2]) {
        const b = new THREE.Mesh(beamG, this.beamMat);
        b.rotation.y = r;
        g.add(b);
      }
      g.position.set(s.x, s.y, s.z);
      scene.add(g);
      this.items.push({ ...s, g, coin, got: false });
    }
    this.total = this.items.length;
  }

  update(dt, t, px, py, pz, onGet) {
    for (const c of this.items) {
      if (c.got) continue;
      c.coin.rotation.y = t * 2.2;
      c.coin.position.y = 1.2 + Math.sin(t * 2 + c.x) * 0.15;
      if (Math.hypot(c.x - px, c.z - pz) < 1.8 && Math.abs(py - c.y) < 2.5) {
        c.got = true;
        c.g.visible = false;
        this.count++;
        onGet(c);
      }
    }
  }
}
