import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand, rr, ri, pick } from './rng.js';
import { BLOCKS, BLOCK, ROAD, LANE, roadC } from './config.js';

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const R = ROAD / 2;
const COLORS = ['#b8241c', '#1f2f45', '#e8eaec', '#f2c21b', '#f2c21b', '#237a45', '#2766a8', '#7c8388', '#141414', '#d0561b', '#6b3a8c', '#b9bec3', '#15877a', '#8a1c2c'];
// paint for specific cars, keyed by the build-mode "car n" id
const PAINTED = { 484: '#c8221a' };
const SHAPES = [[1, 1, 1], [1, 1, 1], [1.06, 1.22, 1.04], [1.18, 1.48, 1.08], [0.86, 0.98, 0.95]];
const inb = (i, j) => i >= 0 && i <= BLOCKS && j >= 0 && j <= BLOCKS;

function colored(g, hex, k = 1) {
  const c = new THREE.Color(hex).multiplyScalar(k);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

function carGeometries() {
  const body = mergeGeometries([
    colored(bx(4.3, 0.62, 1.86, 0, 0.61, 0), '#ffffff'),
    colored(bx(2.1, 0.08, 1.62, -0.25, 1.51, 0), '#ffffff'),
  ]);
  const wheel = () => new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12).rotateX(Math.PI / 2);
  const detail = mergeGeometries([
    colored(bx(2.3, 0.56, 1.7, -0.2, 1.2, 0), '#1b2430'),
    colored(bx(0.14, 0.22, 1.84, 2.17, 0.44, 0), '#222222'),
    colored(bx(0.14, 0.22, 1.84, -2.17, 0.44, 0), '#222222'),
    ...[[1.35, 0.86], [1.35, -0.86], [-1.35, 0.86], [-1.35, -0.86]].map(([x, z]) => colored(wheel().translate(x, 0.36, z), '#161616')),
  ]);
  const lights = mergeGeometries([
    colored(bx(0.06, 0.16, 0.42, 2.16, 0.78, 0.6), '#fff4d6', 2.2),
    colored(bx(0.06, 0.16, 0.42, 2.16, 0.78, -0.6), '#fff4d6', 2.2),
    colored(bx(0.06, 0.14, 0.42, -2.16, 0.8, 0.6), '#ff1a10', 1.6),
    colored(bx(0.06, 0.14, 0.42, -2.16, 0.8, -0.6), '#ff1a10', 1.6),
  ]);
  return { body, detail, lights };
}

export class Vehicles {
  constructor(scene, { ai = 260, parked = [] }) {
    this.list = [];
    this.events = [];
    this.speedScale = 1; // live tweak: multiplies AI cruise speed
    const taken = new Set();
    for (let k = 0; k < ai * 3 && this.list.filter((v) => v.mode === 'ai').length < ai; k++) {
      const i = ri(0, BLOCKS), j = ri(0, BLOCKS), d = ri(0, 3);
      if (!inb(i + DIRS[d][0], j + DIRS[d][1])) continue;
      const s = rr(2, BLOCK - 4);
      const key = `${i},${j},${d},${Math.floor(s / 12)}`;
      if (taken.has(key)) continue;
      taken.add(key);
      const v = this.make('ai');
      Object.assign(v, { ni: i, nj: j, d, s, phase: 0, cruise: rr(9, 14.5), wait: 0, ghost: 0, honkCd: 0 });
      this.chooseNext(v);
      this.placeStraight(v);
      this.list.push(v);
    }
    for (const p of parked) {
      const v = this.make('parked');
      v.x = p.x;
      v.z = p.z;
      v.heading = p.heading;
      this.list.push(v);
    }

    const g = carGeometries();
    const n = this.list.length;
    this.bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.55 });
    this.detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.3 });
    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.body = new THREE.InstancedMesh(g.body, this.bodyMat, n);
    this.detail = new THREE.InstancedMesh(g.detail, this.detailMat, n);
    this.lights = new THREE.InstancedMesh(g.lights, this.lightMat, n);
    const c = new THREE.Color();
    this.list.forEach((v, k) => {
      v.k = k;
      if (PAINTED[k]) v.color = PAINTED[k];
      this.body.setColorAt(k, c.set(v.color));
    });
    // rainbow paint: these cars cycle through the hue wheel
    this.rainbow = [229, 211].map((k) => this.list[k]).filter(Boolean);
    this.rainbowT = 0;
    this.tmpColor = c;
    // crash explosion effects
    this.fx = [];
    this.wrecks = [];
    this.fxGroup = new THREE.Group();
    this.puffGeo = new THREE.IcosahedronGeometry(1, 1);
    this.chunkGeo = new THREE.BoxGeometry(0.5, 0.18, 0.4);
    this.debrisMat = new THREE.MeshStandardMaterial({ color: 0x1e1c1a, roughness: 0.8, metalness: 0.3 });
    scene.add(this.fxGroup);
    for (const m of [this.body, this.detail, this.lights]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this.body.castShadow = this.detail.castShadow = true;
    this.body.receiveShadow = true;
    this.dummy = new THREE.Object3D();
    this.cells = new Map();
    this.near = [];
    for (const v of this.list) this.writeMatrix(v);
  }

  make(mode) {
    const sc = pick(SHAPES);
    return {
      mode, x: 0, y: 0, z: 0, heading: 0, speed: 0, vx: 0, vz: 0, steer: 0, roll: 0, pitch: 0,
      sc, hx: 2.2 * sc[0], hz: 0.95 * sc[2], color: pick(COLORS),
    };
  }

  chooseNext(v) {
    const mi = v.ni + DIRS[v.d][0], mj = v.nj + DIRS[v.d][1];
    const opts = [0, 1, 2, 3].filter((e) => e !== (v.d + 2) % 4 && inb(mi + DIRS[e][0], mj + DIRS[e][1]));
    v.nd = opts.includes(v.d) && rand() < 0.55 ? v.d : pick(opts);
  }

  placeStraight(v) {
    const f = DIRS[v.d];
    const nx = roadC(v.ni) + f[0] * (R + v.s) - f[1] * LANE;
    const nz = roadC(v.nj) + f[1] * (R + v.s) + f[0] * LANE;
    v.x = nx;
    v.z = nz;
    v.heading = Math.atan2(-f[1], f[0]);
  }

  startTurn(v) {
    const f = DIRS[v.d], r = [-f[1], f[0]];
    const Mx = roadC(v.ni + f[0]), Mz = roadC(v.nj + f[1]);
    const nf = DIRS[v.nd], nr = [-nf[1], nf[0]];
    const p0x = Mx - f[0] * R + r[0] * LANE, p0z = Mz - f[1] * R + r[1] * LANE;
    const p2x = Mx + nf[0] * R + nr[0] * LANE, p2z = Mz + nf[1] * R + nr[1] * LANE;
    let p1x, p1z;
    if (v.nd === v.d) {
      p1x = (p0x + p2x) / 2;
      p1z = (p0z + p2z) / 2;
    } else {
      p1x = Mx + (r[0] + nr[0]) * LANE;
      p1z = Mz + (r[1] + nr[1]) * LANE;
    }
    v.bz = [p0x, p0z, p1x, p1z, p2x, p2z];
    let len = 0, px = p0x, pz = p0z;
    for (let k = 1; k <= 10; k++) {
      const t = k / 10, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
      const x = a * p0x + b * p1x + c * p2x, z = a * p0z + b * p1z + c * p2z;
      len += Math.hypot(x - px, z - pz);
      px = x;
      pz = z;
    }
    v.len = len;
    v.t = (v.s - BLOCK) / len;
    v.phase = 1;
  }

  rebuildGrid() {
    for (const a of this.cells.values()) a.length = 0;
    for (const v of this.list) {
      const k = (Math.floor(v.x / 24) + 500) * 2048 + (Math.floor(v.z / 24) + 500);
      let a = this.cells.get(k);
      if (!a) this.cells.set(k, (a = []));
      a.push(v);
    }
  }

  nearby(x, z, out = this.near) {
    out.length = 0;
    const cx = Math.floor(x / 24), cz = Math.floor(z / 24);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        const a = this.cells.get((i + 500) * 2048 + (j + 500));
        if (a) for (const v of a) out.push(v);
      }
    }
    return out;
  }

  // Distance to the closest obstacle in front of an AI car (other vehicle or walking player)
  ahead(v, fx, fz, player) {
    let best = 99, byPlayer = false;
    for (const o of this.nearby(v.x, v.z)) {
      if (o === v) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      const along = dx * fx + dz * fz;
      if (along <= 0.5 || along > 20) continue;
      const lat = Math.abs(-dx * fz + dz * fx);
      if (lat > 2.3) continue;
      const d = along - o.hx;
      if (d < best) {
        best = d;
        byPlayer = o.mode === 'player';
      }
    }
    if (player) {
      const dx = player.x - v.x, dz = player.z - v.z;
      const along = dx * fx + dz * fz;
      if (along > 0.5 && along < 20 && Math.abs(-dx * fz + dz * fx) < 1.9 && along < best) {
        best = along;
        byPlayer = true;
      }
    }
    return [best, byPlayer];
  }

  update(dt, walker) {
    this.rebuildGrid();
    for (const v of this.list) {
      if (v.mode !== 'ai') continue;
      const fx = Math.cos(v.heading), fz = -Math.sin(v.heading);
      let target = v.cruise * this.speedScale;
      const turning = v.nd !== v.d;
      if (turning && v.phase === 0 && v.s > BLOCK - 22) target = Math.min(target, 6 + (BLOCK - v.s) * 0.45);
      if (turning && v.phase === 1) target = Math.min(target, 6.5);
      v.honkCd -= dt;
      if (v.ghost > 0) v.ghost -= dt;
      else {
        const [a, byPlayer] = this.ahead(v, fx, fz, walker);
        if (a < 20) target = Math.min(target, Math.max(0, (a - 2.5 - v.hx) * 1.3));
        if (target < 0.3 && v.speed < 0.5) {
          v.wait += dt;
          if (byPlayer && v.wait > 1.6 && v.honkCd <= 0) {
            this.events.push({ type: 'honk', x: v.x, z: v.z });
            v.honkCd = rr(3, 6);
          }
          if (v.wait > 7) {
            v.ghost = 2.5;
            v.wait = 0;
          }
        } else v.wait = 0;
      }
      v.speed += v.speed < target ? Math.min(target - v.speed, 5.5 * dt) : -Math.min(v.speed - target, 22 * dt);
      const ds = v.speed * dt;
      if (v.phase === 0) {
        v.s += ds;
        if (v.s >= BLOCK) this.startTurn(v);
        else this.placeStraight(v);
      } else v.t += ds / v.len;
      if (v.phase === 1) {
        if (v.t >= 1) {
          v.s = (v.t - 1) * v.len;
          v.ni += DIRS[v.d][0];
          v.nj += DIRS[v.d][1];
          v.d = v.nd;
          v.phase = 0;
          this.chooseNext(v);
          this.placeStraight(v);
        } else {
          const t = v.t, [p0x, p0z, p1x, p1z, p2x, p2z] = v.bz;
          const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
          v.x = a * p0x + b * p1x + c * p2x;
          v.z = a * p0z + b * p1z + c * p2z;
          const tx = 2 * (1 - t) * (p1x - p0x) + 2 * t * (p2x - p1x);
          const tz = 2 * (1 - t) * (p1z - p0z) + 2 * t * (p2z - p1z);
          v.heading = Math.atan2(-tz, tx);
        }
      }
      v.vx = fx * v.speed;
      v.vz = fz * v.speed;
    }
    this.updateFx(dt);
    for (const v of this.list) if (v.mode !== 'parked' || v.dirty) this.writeMatrix(v);
    this.body.instanceMatrix.needsUpdate = true;
    this.detail.instanceMatrix.needsUpdate = true;
    this.lights.instanceMatrix.needsUpdate = true;
    if (this.rainbow.length) {
      this.rainbowT += dt;
      for (const v of this.rainbow) {
        if (v.wrecked) continue;
        v.color = `#${this.tmpColor.setHSL((this.rainbowT * 0.3 + v.k * 0.13) % 1, 0.9, 0.55).getHexString()}`;
        this.body.setColorAt(v.k, this.tmpColor);
      }
      this.body.instanceColor.needsUpdate = true;
    }
  }

  writeMatrix(v) {
    const d = this.dummy;
    d.position.set(v.x, v.y, v.z);
    d.rotation.set(v.roll, v.heading, v.pitch, 'YXZ');
    d.scale.set(v.sc[0], v.sc[1], v.sc[2]);
    d.updateMatrix();
    this.body.setMatrixAt(v.k, d.matrix);
    this.detail.setMatrixAt(v.k, d.matrix);
    if (v.wrecked) d.scale.setScalar(0), d.updateMatrix(); // burnt out: no head/tail lights
    this.lights.setMatrixAt(v.k, d.matrix);
    v.dirty = false;
  }

  // ---------- crash explosions ----------
  explode(v) {
    const R = Math.random; // visual only, so it doesn't need the seeded world RNG
    v.wrecked = true;
    v.mode = 'parked';
    v.vx = v.vz = v.speed = 0;
    v.color = '#1c1a19';
    this.body.setColorAt(v.k, this.tmpColor.set(v.color));
    this.body.instanceColor.needsUpdate = true;
    v.hop = { vy: 7.5, y0: v.y };
    v.roll = (R() - 0.5) * 0.16;
    v.pitch = (R() - 0.5) * 0.1;
    v.burn = 12;
    v.emit = 0;
    v.dirty = true;
    this.wrecks.push(v);
    const y = v.y + 1;
    for (let i = 0; i < 8; i++) {
      this.puff('fire', v.x + (R() - 0.5) * 3, y + R() * 1.4, v.z + (R() - 0.5) * 3, { life: 0.45 + R() * 0.5, size: 2.4 + R() * 2.4, delay: R() * 0.12, vy: 1 + R() * 2 });
    }
    for (let i = 0; i < 14; i++) {
      const a = R() * Math.PI * 2;
      this.puff('smoke', v.x + Math.cos(a) * 1.5, y + R(), v.z + Math.sin(a) * 1.5, {
        life: 3 + R() * 3, size: 1.8 + R() * 2, delay: 0.08 + R() * 0.5, vx: Math.cos(a) * 1.5, vy: 2 + R() * 3, vz: Math.sin(a) * 1.5,
      });
    }
    for (let i = 0; i < 14; i++) {
      const a = R() * Math.PI * 2, s = 6 + R() * 12;
      const m = new THREE.Mesh(this.chunkGeo, this.debrisMat);
      m.position.set(v.x, y, v.z);
      m.scale.set(0.5 + R(), 0.5 + R() * 0.6, 0.5 + R());
      m.castShadow = true;
      this.fxGroup.add(m);
      this.fx.push({ kind: 'debris', mesh: m, t: 0, life: 5 + R() * 2, vx: Math.cos(a) * s, vy: 6 + R() * 10, vz: Math.sin(a) * s, spin: (R() - 0.5) * 20, floor: v.y + 0.1, base: m.scale.clone() });
    }
  }

  puff(kind, x, y, z, { life, size, delay = 0, vx = 0, vy = 0, vz = 0 }) {
    const mat = kind === 'fire'
      ? new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
      : new THREE.MeshLambertMaterial({ color: 0x2a2826, transparent: true, opacity: 0, depthWrite: false });
    const m = new THREE.Mesh(this.puffGeo, mat);
    m.position.set(x, y, z);
    m.visible = false;
    m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    this.fxGroup.add(m);
    this.fx.push({ kind, mesh: m, mat, t: -delay, life, size, vx, vy, vz });
  }

  updateFx(dt) {
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const v = this.wrecks[i];
      if (v.hop) {
        v.hop.vy -= 22 * dt;
        v.y += v.hop.vy * dt;
        if (v.y <= v.hop.y0) {
          v.y = v.hop.y0;
          v.hop = null;
        }
        v.dirty = true;
      }
      v.burn -= dt;
      v.emit -= dt;
      if (v.emit <= 0 && v.burn > 0) {
        v.emit = 0.16;
        const R = Math.random, k = v.burn / 12;
        const x = v.x + (R() - 0.5) * 2, z = v.z + (R() - 0.5) * 2;
        if (R() < 0.3 + k * 0.6) this.puff('fire', x, v.y + 1.4, z, { life: 0.35 + R() * 0.3, size: 0.7 + R() * 0.8 * (0.4 + k), vy: 2.5 });
        this.puff('smoke', x, v.y + 1.8, z, { life: 3 + R() * 2, size: 0.9 + R() * 0.8, vx: (R() - 0.5), vy: 2.5 + R() * 1.5, vz: (R() - 0.5) });
      }
      if (v.burn <= 0 && !v.hop) this.wrecks.splice(i, 1);
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      if (f.t < 0) continue;
      const m = f.mesh;
      const k = f.t / f.life;
      if (k >= 1) {
        this.fxGroup.remove(m);
        f.mat?.dispose();
        this.fx.splice(i, 1);
        continue;
      }
      m.visible = true;
      if (f.kind === 'debris') {
        f.vy -= 22 * dt;
        m.position.x += f.vx * dt;
        m.position.y += f.vy * dt;
        m.position.z += f.vz * dt;
        if (m.position.y < f.floor) {
          m.position.y = f.floor;
          f.vy *= -0.3;
          f.vx *= 0.55;
          f.vz *= 0.55;
          f.spin *= 0.5;
        }
        m.rotation.x += f.spin * dt;
        m.rotation.z += f.spin * 0.7 * dt;
        if (k > 0.85) m.scale.copy(f.base).multiplyScalar((1 - k) / 0.15);
        continue;
      }
      m.position.x += f.vx * dt;
      m.position.y += f.vy * dt;
      m.position.z += f.vz * dt;
      if (f.kind === 'fire') {
        m.scale.setScalar(f.size * (0.35 + 0.65 * Math.sqrt(k)));
        // white-hot core cooling through orange to deep red (values >1 feed the bloom)
        f.mat.color.setRGB(3 * (1 - k * 0.4), 2.2 * (1 - k) ** 1.5 + 0.15, 0.9 * (1 - k) ** 3);
        f.mat.opacity = 1 - k;
      } else {
        m.scale.setScalar(f.size * (0.6 + k * 1.8));
        f.mat.opacity = 0.6 * Math.min(1, f.t * 5) * (1 - k);
      }
    }
  }

  nearest(x, z, maxD) {
    let best = null, bd = maxD;
    for (const v of this.nearby(x, z, [])) {
      if (v.wrecked) continue;
      const d = Math.hypot(v.x - x, v.z - z) - v.hx * 0.6;
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  // Push a walking player's circle out of every car's oriented box.
  pushCircle(p, r) {
    for (const v of this.nearby(p.x, p.z)) {
      if (v.mode === 'player') continue;
      const fx = Math.cos(v.heading), fz = -Math.sin(v.heading);
      const dx = p.x - v.x, dz = p.z - v.z;
      const lx = dx * fx + dz * fz, lz = -dx * fz + dz * fx;
      const hx = v.hx, hz = v.hz;
      const cx = Math.max(-hx, Math.min(hx, lx)), cz = Math.max(-hz, Math.min(hz, lz));
      let ox = lx - cx, oz = lz - cz;
      const d2 = ox * ox + oz * oz;
      if (d2 >= r * r) continue;
      let nlx, nlz;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        nlx = cx + (ox / d) * r;
        nlz = cz + (oz / d) * r;
      } else if (hx - Math.abs(lx) < hz - Math.abs(lz)) {
        nlx = Math.sign(lx || 1) * (hx + r);
        nlz = lz;
      } else {
        nlx = lx;
        nlz = Math.sign(lz || 1) * (hz + r);
      }
      p.x = v.x + nlx * fx - nlz * fz;
      p.z = v.z + nlx * fz + nlz * fx;
    }
  }

  // Resolve the player's car against other cars. Returns the displacement applied.
  collideCar(v, out) {
    out.x = 0;
    out.z = 0;
    const fx = Math.cos(v.heading), fz = -Math.sin(v.heading);
    for (const o of this.nearby(v.x, v.z)) {
      if (o === v) continue;
      if (Math.abs(o.x - v.x) > 8 || Math.abs(o.z - v.z) > 8) continue;
      const ofx = Math.cos(o.heading), ofz = -Math.sin(o.heading);
      for (const a of [-1.35, 0, 1.35]) {
        for (const b of [-1.35, 0, 1.35]) {
          const ax = v.x + fx * a * v.sc[0], az = v.z + fz * a * v.sc[0];
          const bxp = o.x + ofx * b * o.sc[0], bzp = o.z + ofz * b * o.sc[0];
          const dx = ax - bxp, dz = az - bzp;
          const rr2 = v.hz + o.hz + 0.1;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr2 * rr2 || d2 < 1e-9) continue;
          const d = Math.sqrt(d2);
          const push = rr2 - d;
          const nx = dx / d, nz = dz / d;
          if (o.mode === 'parked') {
            v.x += nx * push * 0.5;
            v.z += nz * push * 0.5;
            o.x -= nx * push * 0.5;
            o.z -= nz * push * 0.5;
            o.dirty = true;
            out.x += nx * push * 0.5;
            out.z += nz * push * 0.5;
          } else {
            v.x += nx * push;
            v.z += nz * push;
            out.x += nx * push;
            out.z += nz * push;
          }
        }
      }
    }
    return out;
  }

  setNight(n) {
    this.lightMat.color.setScalar(0.55 + n * 1.2);
  }
}
