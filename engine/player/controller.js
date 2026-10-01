import * as THREE from 'three';
import { resolveCircle } from '../core/collision.js';
import { clamp } from '../core/math.js';

const EYE = 1.7;

export class Player {
  // world: { grid: CollisionGrid, groundY(x, z), spawn: { x, z, yaw?, pitch? }, limit? }
  // vehicles (optional): { pushCircle(p, r), collideCar(car, out) }
  constructor(camera, world, vehicles, audio) {
    this.cam = camera;
    this.world = world;
    this.veh = vehicles || null;
    this.audio = audio;
    this.limit = world.limit ?? 1e6;
    this.walkSpeed = 5.2;
    this.sprintSpeed = 11;
    this.flySpeed = 24;
    this.flyFastSpeed = 75;
    const sp = world.spawn || { x: 0, z: 0 };
    this.pos = new THREE.Vector3(sp.x, world.groundY(sp.x, sp.z), sp.z);
    this.vel = new THREE.Vector3();
    this.yaw = sp.yaw ?? 0;
    this.pitch = sp.pitch ?? 0;
    this.onGround = true;
    this.eyeY = this.pos.y + EYE;
    this.bobT = 0;
    this.stepAcc = 0;
    this.car = null;
    this.camYawOff = 0;
    this.camPitchOff = 0;
    this.mouseIdle = 0;
    this.shake = 0;
    this.camPos = new THREE.Vector3();
    this.camAng = 0;
    this.rects = [];
    this.push = { x: 0, z: 0 };
    this.fov = 72;
    this.flying = false;
    camera.rotation.order = 'YXZ';
  }

  get driving() {
    return !!this.car;
  }

  get focus() {
    return this.car ? { x: this.car.x, z: this.car.z } : this.pos;
  }

  get speed() {
    return this.car ? Math.hypot(this.car.vx, this.car.vz) : Math.hypot(this.vel.x, this.vel.z);
  }

  look(dx, dy) {
    if (this.car) {
      this.camYawOff -= dx * 0.0025;
      this.camPitchOff = clamp(this.camPitchOff + dy * 0.004, -1.5, 5);
      this.mouseIdle = 0;
    } else {
      this.yaw -= dx * 0.0022;
      this.pitch = clamp(this.pitch - dy * 0.0022, -1.5, 1.5);
    }
  }

  update(dt, inp) {
    if (this.car) this.drive(dt, inp);
    else this.walk(dt, inp);
  }

  // Solid boxes at the player's height: each building tier (or tree trunk) whose top is above the feet.
  solidsAt(p) {
    const out = (this.solids ||= []);
    out.length = 0;
    for (const r of this.world.grid.query(p.x, p.z, 2, this.rects)) {
      if (r.tiers) {
        for (const t of r.tiers) if (t.h > p.y + 0.3) out.push(t);
      } else if (r.h > p.y + 0.3) out.push(r);
    }
    return out;
  }

  // Highest walkable surface under (x, z) at or below height y: street, curb or rooftop.
  supportY(x, z, y) {
    let g = this.world.groundY(x, z);
    for (const r of this.world.grid.query(x, z, 0.5, this.rects)) {
      for (const t of r.tiers || [r]) {
        if (t.h > g && t.h <= y + 0.35 && x > t.x0 && x < t.x1 && z > t.z0 && z < t.z1) g = t.h;
      }
    }
    return g;
  }

  toggleFlight() {
    this.flying = !this.flying;
    if (this.flying) {
      this.vel.y = Math.max(this.vel.y, 4);
      this.onGround = false;
    }
    return this.flying;
  }

  walk(dt, inp) {
    const f = (inp.fwd ? 1 : 0) - (inp.back ? 1 : 0);
    const s = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const p = this.pos;
    if (this.flying) {
      // fly toward where you look; Space rises, C / Ctrl sinks
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const u = (inp.jump ? 1 : 0) - (inp.down ? 1 : 0);
      let wx = -sin * cp * f + cos * s, wy = sp * f + u, wz = -cos * cp * f - sin * s;
      const len = Math.hypot(wx, wy, wz);
      const spd = inp.sprint ? this.flyFastSpeed : this.flySpeed;
      if (len > 0) {
        wx = (wx / len) * spd;
        wy = (wy / len) * spd;
        wz = (wz / len) * spd;
      }
      const k = 1 - Math.exp(-3.5 * dt);
      this.vel.x += (wx - this.vel.x) * k;
      this.vel.y += (wy - this.vel.y) * k;
      this.vel.z += (wz - this.vel.z) * k;
    } else {
      let wx = -sin * f + cos * s, wz = -cos * f - sin * s;
      const len = Math.hypot(wx, wz);
      const spd = inp.sprint ? this.sprintSpeed : this.walkSpeed;
      if (len > 0) {
        wx = (wx / len) * spd;
        wz = (wz / len) * spd;
      }
      const k = 1 - Math.exp(-(this.onGround ? 14 : 2.5) * dt);
      this.vel.x += (wx - this.vel.x) * k;
      this.vel.z += (wz - this.vel.z) * k;
      if (inp.jump && this.onGround) {
        this.vel.y = 7.4;
        this.onGround = false;
        inp.jump = false;
      }
      this.vel.y = Math.max(this.vel.y - 22 * dt, -60);
    }
    p.x += this.vel.x * dt;
    p.z += this.vel.z * dt;
    p.y = Math.min(p.y + this.vel.y * dt, 650);

    resolveCircle(p, 0.38, this.solidsAt(p));
    if (p.y < this.world.groundY(p.x, p.z) + 2.5) this.veh?.pushCircle?.(p, 0.38);
    p.x = clamp(p.x, -this.limit, this.limit);
    p.z = clamp(p.z, -this.limit, this.limit);

    const g = this.supportY(p.x, p.z, p.y);
    if (this.flying) {
      if (p.y < g) {
        p.y = g;
        this.vel.y = Math.max(this.vel.y, 0);
      }
      this.onGround = false;
    } else if (p.y <= g || (this.onGround && this.vel.y <= 0 && p.y - g < 0.3)) {
      if (!this.onGround && this.vel.y < -5) this.audio.step(Math.min(2, -this.vel.y / 6));
      p.y = g;
      this.vel.y = 0;
      this.onGround = true;
    } else this.onGround = false;

    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.5) {
      this.bobT += dt * hs * 1.25;
      this.stepAcc += hs * dt;
      if (this.stepAcc > (inp.sprint ? 2.6 : 1.8)) {
        this.stepAcc = 0;
        this.audio.step(inp.sprint ? 1.1 : 0.8);
      }
    }
    const bob = this.onGround ? Math.sin(this.bobT * 2) * 0.05 * Math.min(1, hs / 5) : 0;
    const eyeTarget = p.y + EYE;
    // snap on big vertical moves (falls, flight), smooth small ones (curbs)
    if (Math.abs(eyeTarget - this.eyeY) > 0.6) this.eyeY = eyeTarget;
    else this.eyeY += (eyeTarget - this.eyeY) * (1 - Math.exp(-20 * dt));
    this.cam.position.set(p.x, this.eyeY + bob, p.z);
    const bank = this.flying ? clamp(-s * 0.06 * Math.min(1, hs / 20), -0.08, 0.08) : Math.sin(this.bobT) * 0.004 * Math.min(1, hs / 5);
    this.bankZ = (this.bankZ || 0) + (bank - (this.bankZ || 0)) * (1 - Math.exp(-5 * dt));
    this.cam.rotation.set(this.pitch, this.yaw, this.bankZ, 'YXZ');
    const fovTarget = this.flying ? 72 + Math.min(20, this.vel.length() * 0.25) : inp.sprint && hs > 6 ? 80 : 72;
    this.fov += (fovTarget - this.fov) * (1 - Math.exp(-6 * dt));
  }

  // Move the player (on foot) to a point, e.g. "play from here" in build mode.
  teleport(x, y, z, yaw = this.yaw, pitch = 0) {
    if (this.car) this.exit(true);
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.eyeY = y + EYE;
    this.yaw = yaw;
    this.pitch = pitch;
    this.onGround = false;
  }

  get altitude() {
    return this.pos.y - this.world.groundY(this.pos.x, this.pos.z);
  }

  drive(dt, inp) {
    const v = this.car;
    let h = v.heading;
    let fx = Math.cos(h), fz = -Math.sin(h), rx = -fz, rz = fx;
    let vf = v.vx * fx + v.vz * fz;
    let vl = v.vx * rx + v.vz * rz;
    const vf0 = vf;
    const MAX = inp.sprint ? 52 : 40, REV = 11;
    const thr = inp.fwd ? 1 : 0, brk = inp.back ? 1 : 0;
    if (thr) vf += (vf < 0 ? 30 : (inp.sprint ? 22 : 15) * Math.max(0, 1 - vf / MAX)) * dt;
    if (brk) vf -= (vf > 0.5 ? 32 : 9 * Math.max(0, 1 + vf / REV)) * dt;
    if (!thr && !brk) vf -= Math.sign(vf) * Math.min(Math.abs(vf), (2.2 + Math.abs(vf) * 0.07) * dt);
    const hand = inp.jump;
    if (hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 12 * dt);

    const steerIn = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
    v.steer += (steerIn - v.steer) * (1 - Math.exp(-8 * dt));
    const sp = Math.abs(vf);
    const yawRate = v.steer * (2.4 / (1 + sp / 24)) * Math.min(1, sp / 4) * Math.sign(vf) * (hand ? 1.4 : 1);
    h += yawRate * dt;
    v.heading = h;
    vl *= Math.exp(-(hand ? 1.1 : 9) * dt);
    fx = Math.cos(h);
    fz = -Math.sin(h);
    rx = -fz;
    rz = fx;
    v.vx = fx * vf + rx * vl;
    v.vz = fz * vf + rz * vl;
    const ox = v.x, oz = v.z;
    v.x += v.vx * dt;
    v.z += v.vz * dt;

    // collide with buildings (three circles along the car) and other cars
    const rad = v.hz + 0.05;
    const rects = this.world.grid.query(v.x, v.z, 6, this.rects);
    for (let it = 0; it < 2; it++) {
      for (const a of [-1.3, 0, 1.3]) {
        const c = { x: v.x + fx * a * v.sc[0], z: v.z + fz * a * v.sc[0] };
        const bx = c.x, bz = c.z;
        if (resolveCircle(c, rad, rects)) {
          v.x += c.x - bx;
          v.z += c.z - bz;
        }
      }
    }
    this.veh?.collideCar?.(v, this.push);
    v.x = clamp(v.x, -this.limit + 2, this.limit - 2);
    v.z = clamp(v.z, -this.limit + 2, this.limit - 2);
    const expectedX = ox + v.vx * dt, expectedZ = oz + v.vz * dt;
    const dx = v.x - expectedX, dz = v.z - expectedZ;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-4) {
      const nx = dx / dl, nz = dz / dl;
      const vn = v.vx * nx + v.vz * nz;
      if (vn < 0) {
        v.vx -= nx * vn * 1.25;
        v.vz -= nz * vn * 1.25;
        v.vx *= 0.85;
        v.vz *= 0.85;
        if (-vn > 4) {
          this.audio.crash(-vn);
          this.shake = Math.min(1, -vn / 25);
        }
      }
    }

    const g = this.world.groundY(v.x, v.z);
    v.y += (g - v.y) * (1 - Math.exp(-18 * dt));
    v.roll += (clamp(yawRate * sp * 0.01, -0.07, 0.07) - v.roll) * (1 - Math.exp(-6 * dt));
    const accel = (vf - vf0) / Math.max(dt, 1e-4);
    v.pitch += (clamp(accel * 0.0025, -0.05, 0.035) - v.pitch) * (1 - Math.exp(-6 * dt));
    v.speed = vf;
    this.audio.engine(true, vf, thr);

    // chase camera
    this.mouseIdle += dt;
    if (this.mouseIdle > 1.2) {
      this.camYawOff *= Math.exp(-2.5 * dt);
      this.camPitchOff *= Math.exp(-2.5 * dt);
    }
    const dist = 7.2 * v.sc[0] + sp * 0.035;
    const want = h + Math.PI + this.camYawOff;
    let da = want - this.camAng;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    this.camAng += da * (1 - Math.exp(-5 * dt));
    const ang = this.camAng;
    const target = new THREE.Vector3(v.x + fx * 1.5, v.y + 1.3 * v.sc[1], v.z + fz * 1.5);
    const desired = new THREE.Vector3(v.x + Math.cos(ang) * dist, v.y + 2.7 * v.sc[1] + this.camPitchOff, v.z - Math.sin(ang) * dist);
    // keep the camera out of buildings
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      const x = target.x + (desired.x - target.x) * t, z = target.z + (desired.z - target.z) * t;
      if (this.world.grid.pointInside(x, z, 0.4)) {
        desired.lerpVectors(target, desired, Math.max(0.15, (k - 1.5) / 8));
        break;
      }
    }
    this.camPos.x = desired.x;
    this.camPos.z = desired.z;
    this.camPos.y += (desired.y - this.camPos.y) * (1 - Math.exp(-8 * dt));
    this.camPos.y = Math.max(this.camPos.y, g + 0.8);
    this.shake *= Math.exp(-6 * dt);
    const sh = this.shake * 0.35;
    this.cam.position.copy(this.camPos).add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
    this.cam.lookAt(target);
    this.fov += (70 + Math.min(20, sp * 0.4) - this.fov) * (1 - Math.exp(-4 * dt));
  }

  enter(v) {
    this.flying = false;
    this.car = v;
    v.mode = 'player';
    v.vx = Math.cos(v.heading) * v.speed;
    v.vz = -Math.sin(v.heading) * v.speed;
    v.steer = 0;
    this.camPos.copy(this.cam.position);
    this.camAng = v.heading + Math.PI;
    this.camYawOff = 0;
    this.camPitchOff = 0;
    this.audio.door();
  }

  exit(force = false) {
    const v = this.car;
    if (!force && Math.hypot(v.vx, v.vz) > 7) return false;
    const fx = Math.cos(v.heading), fz = -Math.sin(v.heading);
    const rx = -fz, rz = fx;
    let placed = false;
    for (const side of [-1, 1]) {
      const d = v.hz + 0.9;
      const x = v.x + rx * side * d, z = v.z + rz * side * d;
      if (!this.world.grid.pointInside(x, z, 0.5)) {
        this.pos.set(x, this.world.groundY(x, z), z);
        placed = true;
        break;
      }
    }
    if (!placed) this.pos.set(v.x + fx * (v.hx + 1), this.world.groundY(v.x, v.z), v.z + fz * (v.hx + 1));
    this.vel.set(0, 0, 0);
    this.eyeY = this.pos.y + EYE;
    this.yaw = Math.atan2(-fx, -fz);
    this.pitch = 0;
    v.mode = 'parked';
    v.vx = v.vz = v.speed = 0;
    v.roll = v.pitch = 0;
    v.dirty = true;
    this.car = null;
    this.audio.engine(false, 0, 0);
    this.audio.door();
    return true;
  }
}
