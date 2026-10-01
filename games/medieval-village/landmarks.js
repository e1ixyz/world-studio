import * as THREE from 'three';
import { createRng } from '../../engine/index.js';
import { projectUV } from './kit.js';
import { groundY, shoreZ, KEEP, SEPT, PIT, PIERS } from './layout.js';

const R = createRng('kings-landing-landmarks');
const { rand, rr, pick } = R;

// Triangular prism (a gabled roof) of width w (x), height h, depth d (z), bottom-center at x, y, z.
function prism(kit, key, w, h, d, x, y, z, rotY = 0, s = 3) {
  const sh = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  g.rotateY(rotY);
  g.translate(x, y, z);
  projectUV(g, s);
  return kit.add(key, g);
}

function banner(kit, key, x, y, z, rot, w = 2.6, h = 7) {
  const g = new THREE.PlaneGeometry(w, h).translate(0, -h / 2, 0);
  return kit.place(key, g, x, y, z, rot);
}

function crenelRect(kit, key, x0, x1, z0, z1, y, step = 2.6) {
  for (let x = x0 + 0.8; x < x1; x += step) for (const z of [z0 + 0.35, z1 - 0.35]) kit.box(key, 1.4, 0.7, x, y, y + 1.4, z);
  for (let z = z0 + 0.8 + step; z < z1 - step / 2; z += step) for (const x of [x0 + 0.35, x1 - 0.35]) kit.box(key, 0.7, 1.4, x, y, y + 1.4, z);
}

// ---------- the Red Keep on Aegon's High Hill ----------
export function buildRedKeep(kit, grid, { wallRun, roundTower }) {
  const K0 = groundY(KEEP.x, KEEP.z);
  const { x: cx, z: cz, half } = KEEP;
  const x0 = cx - half, x1 = cx + half, z0 = cz - half, z1 = cz + half;
  const topFn = (x, z) => Math.max(K0 + 15, groundY(x, z) + 8);
  const opt = { key: 'red', thick: 5, topFn };
  wallRun(x0, z0, cx - 16, z0, opt);
  wallRun(cx + 16, z0, x1, z0, opt);
  wallRun(x1, z0, x1, z1, opt);
  wallRun(x1, z1, x0, z1, opt);
  wallRun(x0, z1, x0, z0, opt);
  const tower = (x, z, r, top, key = 'red', roof = 'roofRed') => roundTower(x, z, r, top - groundY(x, z), key, roof);
  [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].forEach(([x, z], i) => tower(x, z, 8, K0 + 24, 'red', i % 2 ? 'roofRed' : null));
  for (const [x, z] of [[x1, cz], [cx, z1], [x0, cz]]) tower(x, z, 6, K0 + 20, 'red', null);

  // gatehouse
  for (const s of [-1, 1]) {
    const gx = cx + s * 11;
    kit.box('red', 10, 12, gx, K0 - 3, K0 + 23, z0);
    crenelRect(kit, 'red', gx - 5, gx + 5, z0 - 6, z0 + 6, K0 + 23);
    grid.add({ x0: gx - 5, x1: gx + 5, z0: z0 - 6, z1: z0 + 6, h: K0 + 23 });
  }
  kit.box('red', 12.5, 11, cx, K0 + 10, K0 + 23, z0);
  kit.box('dark', 12.4, 10.6, cx, K0 + 8.6, K0 + 10, z0);
  const banners = [];
  for (const bx of [x0 + 12, x0 + 26, x1 - 26, x1 - 12]) banners.push(banner(kit, 'bannerL', bx, K0 + 14, z0 - 2.65, Math.PI, 3, 9));
  for (const s of [-1, 1]) banner(kit, 'bannerB', cx + s * 11, K0 + 21, z0 - 6.1, Math.PI, 3.4, 10);

  // courtyard paving
  kit.box('paving', 2 * half - 4, 2 * half - 4, cx, K0 - 1, K0 + 0.06, cz);

  // Maegor's Holdfast
  const mx = 198, mz = 126, mh = 16;
  kit.box('red', 2 * mh, 2 * mh, mx, K0 - 1, K0 + 30, mz);
  kit.box('red', 2 * mh + 1.2, 2 * mh + 1.2, mx, K0 + 29.2, K0 + 30, mz);
  crenelRect(kit, 'red', mx - mh - 0.6, mx + mh + 0.6, mz - mh - 0.6, mz + mh + 0.6, K0 + 30);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const tx = mx + sx * mh, tz = mz + sz * mh;
    kit.cyl('red', 3.6, 3.8, tx, K0 - 1, K0 + 36, tz, 12);
    kit.cyl('roofRed', 0, 4.4, tx, K0 + 36, K0 + 43, tz, 12);
  }
  for (let i = 0; i < 5; i++) for (const [fx, fz, w, d] of [[0, -mh - 0.05, 1.2, 0.3], [-mh - 0.05, 0, 0.3, 1.2]]) {
    const off = -10 + i * 5;
    kit.box('dark', w, d, mx + (fx ? fx : off), K0 + 18, K0 + 22, mz + (fz ? fz : off));
  }
  grid.add({ x0: mx - mh, x1: mx + mh, z0: mz - mh, z1: mz + mh, h: K0 + 30 });

  // Great Hall: the throne room
  const hx = 150, hz = 112, hw = 11, hd = 23;
  kit.box('red', 2 * hw, 2 * hd, hx, K0 - 1, K0 + 17, hz);
  prism(kit, 'roofRed', 2 * hw + 1.4, 9, 2 * hd + 1.2, hx, K0 + 17, hz);
  for (let i = 0; i < 6; i++) {
    const z = hz - hd + 5 + i * 7.2;
    for (const s of [-1, 1]) kit.box('dark', 0.3, 1.5, hx + s * (hw + 0.05), K0 + 5, K0 + 13, z);
  }
  kit.box('dark', 6, 0.3, hx, K0, K0 + 8, hz - hd - 0.05);
  grid.add({ x0: hx - hw, x1: hx + hw, z0: hz - hd, z1: hz + hd, h: K0 + 17 });

  // Tower of the Hand, White Sword Tower, a kitchen tower
  tower(140, 145, 6.5, K0 + 38);
  tower(213, 72, 5, K0 + 31, 'white', 'roofDark');
  tower(137, 72, 5, K0 + 27);
  return { K0, banners, parts: [
    { kind: 'red keep', id: 'curtain wall', box: [x0 - 8, K0 - 5, z0 - 8, x1 + 8, K0 + 24, z1 + 8] },
    { kind: 'red keep', id: "Maegor's Holdfast", box: [mx - mh, K0, mz - mh, mx + mh, K0 + 43, mz + mh] },
    { kind: 'red keep', id: 'throne room', box: [hx - hw, K0, hz - hd, hx + hw, K0 + 26, hz + hd] },
    { kind: 'red keep', id: 'Tower of the Hand', box: [133.5, K0, 138.5, 146.5, K0 + 48, 151.5] },
    { kind: 'red keep', id: 'White Sword Tower', box: [208, K0, 67, 218, K0 + 39, 77] },
    { kind: 'red keep', id: 'gatehouse', box: [cx - 16, K0, z0 - 6, cx + 16, K0 + 25, z0 + 6] },
  ] };
}

// ---------- the Great Sept of Baelor on Visenya's Hill ----------
export function buildSept(kit, grid) {
  const { x, z } = SEPT;
  const S0 = groundY(x, z);
  for (let k = 0; k < 8; k++) {
    const h = 44 - k * 0.55, top = S0 + 0.3 * (k + 1);
    kit.box('marble', 2 * h, 2 * h, x, S0 - 3, top, z, 0, 4);
    grid.add({ x0: x - h, x1: x + h, z0: z - h, z1: z + h, h: top });
  }
  const P = S0 + 2.4;
  const oct = { theta: Math.PI / 8, s: 5 };
  kit.cyl('marble', 33, 33, x, P - 0.5, P + 18, z, 8, oct);
  kit.cyl('marble', 34.3, 34.3, x, P + 17.2, P + 18.4, z, 8, oct);
  kit.cyl('marble', 25, 25, x, P + 18, P + 27, z, 8, oct);
  kit.cyl('gold', 26, 26, x, P + 26.4, P + 27.2, z, 8, oct);
  kit.cyl('marble', 18.6, 19.2, x, P + 27, P + 32, z, 24, { s: 5 });
  const dome = new THREE.SphereGeometry(19, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.2, 1);
  kit.place('marble', dome, x, P + 32, z);
  for (let i = 0; i < 8; i++) {
    const rib = new THREE.TorusGeometry(19.15, 0.35, 5, 20, Math.PI / 2).scale(1, 1.2, 1);
    kit.place('gold', rib, x, P + 32, z, (i / 8) * Math.PI * 2);
  }
  const domeTop = P + 32 + 19 * 1.2;
  kit.cyl('gold', 3, 3.2, x, domeTop - 1, domeTop + 5, z, 12);
  kit.cyl('gold', 0, 3.6, x, domeTop + 5, domeTop + 13, z, 8);
  grid.add({ x0: x - 30.4, x1: x + 30.4, z0: z - 30.4, z1: z + 30.4, h: P + 18 });

  // the seven crystal-topped towers
  const towers = [];
  for (let k = 0; k < 7; k++) {
    const a = Math.PI / 7 + (k * 2 * Math.PI) / 7;
    const tx = x + Math.cos(a) * 38.5, tz = z + Math.sin(a) * 38.5;
    kit.cyl('marble', 2.5, 3.4, tx, P - 0.5, P + 38, tz, 12, { s: 5 });
    kit.cyl('gold', 3.2, 3.2, tx, P + 37.6, P + 38.6, tz, 12);
    kit.cyl('gold', 0, 3, tx, P + 38.6, P + 47, tz, 8);
    grid.add({ x0: tx - 3, x1: tx + 3, z0: tz - 3, z1: tz + 3, h: P + 38 });
    towers.push({ x: tx, z: tz, top: P + 47 });
  }
  // east portico and doors
  const fx = x + 30.5;
  for (const dz of [-10.5, -6.3, -2.1, 2.1, 6.3, 10.5]) {
    kit.cyl('marble', 0.9, 1.05, fx + 5.5, P, P + 14, z + dz, 12, { s: 5 });
    grid.add({ x0: fx + 4.6, x1: fx + 6.4, z0: z + dz - 0.9, z1: z + dz + 0.9, h: P + 14 });
  }
  kit.box('marble', 8, 24, fx + 3.8, P + 14, P + 16.5, z, 0, 5);
  prism(kit, 'marble', 24, 4.5, 8, fx + 3.8, P + 16.5, z, Math.PI / 2, 5);
  kit.box('dark', 0.5, 8, fx + 0.1, P, P + 11, z);
  kit.box('gold', 0.3, 8.8, fx + 0.35, P + 11, P + 11.6, z);
  return {
    S0, P, towers, parts: [
      { kind: 'great sept', id: 'Great Sept of Baelor', box: [x - 44, S0 - 2, z - 44, x + 44, domeTop + 13, z + 44] },
      ...towers.map((t, i) => ({ kind: 'sept tower', id: `tower ${i + 1} of 7`, box: [t.x - 3.4, P, t.z - 3.4, t.x + 3.4, t.top, t.z + 3.4] })),
    ],
  };
}

// ---------- the ruined Dragonpit on Rhaenys's Hill ----------
export function buildDragonpit(scene, kit, grid, T) {
  const { x, z, r } = PIT;
  const D0 = groundY(x, z);
  const H = 26;
  T.arches.repeat.set(6, 1);
  const mat = new THREE.MeshStandardMaterial({ map: T.arches, color: '#bca98c', roughness: 0.95, alphaTest: 0.5, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 2, H, 64, 1, true), mat);
  ring.position.set(x, D0 - 2 + H / 2, z);
  ring.castShadow = ring.receiveShadow = true;
  scene.add(ring);
  const top = D0 - 2 + H;
  kit.cyl('pit', r + 1.2, r + 1.2, x, top - 1.5, top + 0.5, z, 64, { open: true });
  kit.cyl('pit', r - 0.6, r - 0.6, x, top - 1.5, top + 0.5, z, 64, { open: true });
  for (let k = 0; k < 16; k++) {
    const full = rand() < 0.35;
    const arc = (Math.PI / 2) * (full ? 1 : rr(0.3, 0.82));
    const rib = new THREE.TorusGeometry(r, 1.0, 6, 24, arc);
    kit.place('pit', rib, x, top, z, (k / 16) * Math.PI * 2);
  }
  for (let i = 0; i < 30; i++) {
    const a = rand() * Math.PI * 2, d = rr(8, r - 4);
    const bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d;
    const s = rr(1, 3.2), g = groundY(bx, bz);
    const box = new THREE.BoxGeometry(s * rr(1, 2), s, s * rr(0.8, 1.6));
    box.rotateX(rr(-0.5, 0.5));
    box.rotateZ(rr(-0.5, 0.5));
    kit.place('pit', projectUV(box, 3), bx, g + s * 0.3, bz, rand() * 3);
    if (s > 2) grid.add({ x0: bx - s * 0.5, x1: bx + s * 0.5, z0: bz - s * 0.5, z1: bz + s * 0.5, h: g + s * 0.7 });
  }
  for (let deg = 0; deg < 360; deg += 4) {
    const a = (deg * Math.PI) / 180;
    if (Math.abs(a - Math.PI / 2) < 0.14) continue; // south entrance
    const px = x + Math.cos(a) * (r + 1), pz = z + Math.sin(a) * (r + 1);
    grid.add({ x0: px - 2, x1: px + 2, z0: pz - 2, z1: pz + 2, h: top });
  }
  return { D0, ringMat: mat, parts: [{ kind: 'dragonpit', id: 'the Dragonpit', box: [x - r - 2, D0 - 2, z - r - 2, x + r + 2, top + r, z + r + 2] }] };
}

// ---------- Blackwater docks and ships ----------
export function buildDocks(kit, grid) {
  const piers = [];
  for (const px of PIERS) {
    const za = 184, zb = shoreZ(px) + 58;
    const zc = (za + zb) / 2, L = zb - za;
    kit.box('woodK', 5, L, px, 1.9, 2.4, zc, 0, 4);
    for (let zz = za + 8; zz <= zb; zz += 6) for (const s of [-1, 1]) kit.cyl('woodK', 0.26, 0.26, px + s * 2.3, -7, 3.1, zz, 6);
    for (let i = 0; i < 5; i++) {
      const bz = rr(za + 20, zb - 3), bxo = pick([-1.6, 1.6]);
      if (rand() < 0.5) kit.cyl('woodK', 0.45, 0.45, px + bxo, 2.4, 3.5, bz, 10);
      else kit.box('woodK', 1.1, 1.1, px + bxo, 2.4, 3.5, bz, rand());
    }
    grid.add({ x0: px - 2.5, x1: px + 2.5, z0: za, z1: zb, h: 2.4 });
    piers.push({ x: px, z0: za, z1: zb });
  }
  return piers;
}

const SAILS = ['#8e1c1c', '#d9b54a', '#2a2a2a', '#e8e1cf', '#8e1c1c', '#3b4f78', '#e8e1cf'];
export function buildShips(scene, piers) {
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-2.4, -8);
  hullShape.lineTo(2.4, -8);
  hullShape.quadraticCurveTo(3.1, 2, 0, 10);
  hullShape.quadraticCurveTo(-3.1, 2, -2.4, -8);
  const hullG = new THREE.ExtrudeGeometry(hullShape, { depth: 3, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, bevelSegments: 1 });
  hullG.rotateX(-Math.PI / 2);
  const hullMat = new THREE.MeshStandardMaterial({ color: '#5b3e29', roughness: 0.85 });
  const deckMat = new THREE.MeshStandardMaterial({ color: '#8d6a47', roughness: 0.9 });
  const mastMat = new THREE.MeshStandardMaterial({ color: '#4a3322', roughness: 0.9 });
  const sailG = new THREE.PlaneGeometry(9, 9, 8, 6);
  const sp = sailG.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const u = sp.getX(i) / 4.5, v = sp.getY(i) / 4.5;
    sp.setZ(i, -(1 - u * u) * (1 - v * v * 0.5) * 1.3);
  }
  sailG.computeVertexNormals();
  const ships = [];
  const make = (x, z, heading, sailCol, moving) => {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(hullG, hullMat);
    hull.position.y = -1.3;
    const castle = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2, 4), deckMat);
    castle.position.set(0, 2.4, 6);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 16, 8), mastMat);
    mast.position.set(0, 9.5, -0.5);
    const yard = new THREE.Mesh(new THREE.BoxGeometry(10, 0.3, 0.3), mastMat);
    yard.position.set(0, 15.7, -0.3);
    const sail = new THREE.Mesh(sailG, new THREE.MeshStandardMaterial({ color: sailCol, roughness: 0.9, side: THREE.DoubleSide }));
    sail.position.set(0, 11, -0.3);
    for (const m of [hull, castle, mast, yard, sail]) {
      m.castShadow = true;
      g.add(m);
    }
    g.position.set(x, 0, z);
    g.rotation.y = heading;
    scene.add(g);
    ships.push({ g, x, z, heading, ph: rand() * 10, moving, a: rand() * Math.PI * 2, sail: sailCol, id: `ship ${ships.length + 1}` });
  };
  piers.slice(0, 4).forEach((p, i) => make(p.x + (i % 2 ? 6 : -6), p.z1 - 8, Math.PI, pick(SAILS), false));
  for (let i = 0; i < 7; i++) make(rr(-600, 600), rr(360, 900), rand() * Math.PI * 2, pick(SAILS), i < 3);
  return {
    list: ships,
    bob: 1,
    update(dt, t) {
      for (const s of ships) {
        if (s.moving) {
          s.a += dt * 0.012;
          const nx = Math.cos(s.a) * 520, nz = 620 + Math.sin(s.a) * 220;
          s.heading = Math.atan2(-(nx - s.x), -(nz - s.z)) || s.heading;
          s.x = nx;
          s.z = nz;
        }
        s.g.position.set(s.x, Math.sin(t * 0.9 + s.ph) * 0.22 * this.bob, s.z);
        s.g.rotation.set(Math.sin(t * 0.6 + s.ph) * 0.02 * this.bob, s.heading, Math.sin(t * 0.75 + s.ph * 2) * 0.045 * this.bob, 'YXZ');
      }
    },
  };
}
