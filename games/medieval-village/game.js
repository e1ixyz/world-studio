import * as THREE from 'three';
import { defineGame, CollisionGrid, buildMountains, createRng } from '../../engine/index.js';
import { makeTextures } from './textures.js';
import { buildTerrain, buildWater } from './terrain.js';
import { buildCity } from './city.js';
import { buildRedKeep, buildSept, buildDragonpit, buildDocks, buildShips } from './landmarks.js';
import { Folk, Dragon, Coins } from './life.js';
import { drawMap, MAP_HALF } from './map.js';
import {
  groundY, terrainY, insideWalls, distToWall, roadClear, districtAt, riverX, RIVER_W,
  GATES, KEEP, SEPT, PIT, PLAZA, FLEA, PIERS,
} from './layout.js';

// King's Landing: three hills above Blackwater Bay, the Red Keep, the Great Sept of Baelor,
// the ruined Dragonpit, walls and gates, docks, smallfolk, and a dragon overhead.
export default defineGame({
  title: 'Medieval Village',
  controls: [['M', 'map of the city']],

  async setup(ctx) {
    const { scene, hud, audio, tweaks, select, slug } = ctx;
    const src = (file, fn) => `games/${slug}/${file}${fn ? ` → ${fn}` : ''}`;
    const grid = new CollisionGrid(32);
    const T = makeTextures();

    const terrain = buildTerrain(scene, T);
    const water = buildWater(scene, ctx.textures.waterNormal);
    buildMountains(scene);
    const city = buildCity(scene, T, grid);
    const { kit } = city;
    const keep = buildRedKeep(kit, grid, city);
    const sept = buildSept(kit, grid);
    const pit = buildDragonpit(scene, kit, grid, T);
    const piers = buildDocks(kit, grid);

    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, ...o });
    const mats = {
      wall: std({ map: T.stone, color: '#dcc79e' }),
      red: std({ map: T.stone, color: '#b35a3f' }),
      white: std({ map: T.stone, color: '#f1eee6' }),
      pit: std({ map: T.stone, color: '#a8977c' }),
      paving: std({ map: T.stone, color: '#bba88e' }),
      roofRed: std({ map: T.roof, color: '#9a3a2a', roughness: 0.8 }),
      roofDark: std({ map: T.roof, color: '#5e2c22', roughness: 0.8 }),
      dark: std({ color: '#1a1410' }),
      woodK: std({ map: T.wood, color: '#b89a7a' }),
      marble: std({ map: T.marble, color: '#f6f3ec', roughness: 0.45 }),
      gold: std({ color: '#d9ab45', metalness: 0.8, roughness: 0.3 }),
      bannerL: std({ map: T.lannister, side: THREE.DoubleSide, alphaTest: 0.5 }),
      bannerB: std({ map: T.baratheon, side: THREE.DoubleSide, alphaTest: 0.5 }),
    };
    for (const b of city.bannerKit) kit.place(Math.abs(b.x) % 2 < 1 ? 'bannerL' : 'bannerB', new THREE.PlaneGeometry(2.6, b.h).translate(0, -b.h / 2, 0), b.x, b.y, b.z, b.rot);
    kit.build(scene, mats);

    const ships = buildShips(scene, piers);
    const folk = new Folk(scene, 340);
    const dragon = new Dragon(scene);

    // ---------- torches ----------
    const tp = new Float32Array(city.torches.length * 3);
    city.torches.forEach((p, i) => tp.set(p, i * 3));
    const torchGeo = new THREE.BufferGeometry();
    torchGeo.setAttribute('position', new THREE.BufferAttribute(tp, 3));
    const flameMat = new THREE.PointsMaterial({ map: ctx.textures.pool, color: '#ffb347', size: 1.1, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const haloMat = new THREE.PointsMaterial({ map: ctx.textures.pool, color: '#ff8a2a', size: 7, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    scene.add(new THREE.Points(torchGeo, flameMat), new THREE.Points(torchGeo, haloMat));
    let torchGlow = 1, windowGlow = 1.2;

    // ---------- gold dragons ----------
    const R = createRng('kings-landing-coins');
    const spots = [
      { x: KEEP.x, z: KEEP.z - 30, y: keep.K0, where: 'Red Keep courtyard' },
      { x: SEPT.x + 34, z: SEPT.z, y: sept.P, where: 'steps of the Great Sept' },
      { x: PIT.x + 6, z: PIT.z + 4, y: pit.D0, where: 'floor of the Dragonpit' },
      { x: PIERS[3], z: piers[3].z1 - 3, y: 2.4, where: 'end of a Blackwater pier' },
      { x: riverX(120) + RIVER_W + 12, z: 120, y: 0, where: 'bank of the Blackwater Rush' },
    ];
    const kg = GATES.find((g) => g.name === "King's Gate");
    spots.push({ x: kg.x + kg.nx * 80, z: kg.z + kg.nz * 80, y: 0, where: 'the Kingsroad' });
    let guard = 0;
    while (spots.length < 20 && guard++ < 5000) {
      const flea = spots.length < 9;
      const x = flea ? FLEA.x + R.rr(-60, 60) : R.rr(-300, 320), z = flea ? FLEA.z + R.rr(-60, 60) : R.rr(-320, 170);
      if (!insideWalls(x, z) || distToWall(x, z) < 12 || grid.pointInside(x, z, 1.2) || roadClear(x, z, 8) < 0.8) continue;
      if (terrainY(x, z) < 1.5 || districtAt(x, z) === 'The Red Keep') continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 40)) continue;
      spots.push({ x, z, y: 0, where: flea ? 'Flea Bottom' : 'the alleys' });
    }
    for (const s of spots) if (!s.y) s.y = groundY(s.x, s.z);
    const coins = new Coins(scene, spots, ctx.textures.beam);

    // ---------- point-and-prompt ----------
    city.houses.forEach((h, i) =>
      select.add({
        kind: h.flea ? 'Flea Bottom hovel' : 'house', id: `#${i}`, box: [h.x0, h.top - h.stories * 3.1, h.z0, h.x1, h.ridge, h.z1],
        props: { stories: h.stories, roof: h.roof }, source: src('city.js', 'addHouse()'),
      }),
    );
    for (const p of keep.parts) select.add({ ...p, source: src('landmarks.js', 'buildRedKeep()') });
    for (const p of sept.parts) select.add({ ...p, source: src('landmarks.js', 'buildSept()') });
    for (const p of pit.parts) select.add({ ...p, source: src('landmarks.js', 'buildDragonpit()') });
    for (const t of city.wallTowers) select.add({ kind: 'tower', box: [t.x - t.r, t.top - 18, t.z - t.r, t.x + t.r, t.top + 2, t.z + t.r], props: { radius: t.r }, source: src('city.js', 'roundTower()') });
    for (const g of GATES) {
      const y = groundY(g.x, g.z);
      select.add({ kind: 'gate', id: g.name, box: [g.x - 14, y, g.z - 14, g.x + 14, y + 22, g.z + 14], props: { name: g.name }, source: src('city.js', 'buildCity() → gates') });
    }
    piers.forEach((p, i) => select.add({ kind: 'pier', id: `pier ${i + 1}`, box: [p.x - 2.5, -1, p.z0, p.x + 2.5, 3.5, p.z1], props: { length: Math.round(p.z1 - p.z0) }, source: src('landmarks.js', 'buildDocks()') }));
    for (const s of city.stalls) {
      const y = groundY(s.x, s.z);
      select.add({ kind: 'market stall', box: [s.x - 1.6, y, s.z - 1.6, s.x + 1.6, y + 3, s.z + 1.6], props: { square: s.square }, source: src('city.js', 'stall()') });
    }
    select.add({ kind: 'square', id: PLAZA.name, box: [PLAZA.x - PLAZA.r, 0, PLAZA.z - PLAZA.r, PLAZA.x + PLAZA.r, groundY(PLAZA.x, PLAZA.z) + 0.3, PLAZA.z + PLAZA.r], source: src('city.js', 'buildCity() → streets and squares') });
    select.add({ kind: 'ground', box: [-2600, -8, -2600, 2600, 0.2, 2600], props: {}, source: src('terrain.js', 'buildTerrain()') });
    select.addProvider(() => ships.list.map((s) => ({
      kind: 'ship', id: s.id, props: { sail: s.sail, sailing: s.moving }, source: src('landmarks.js', 'buildShips()'),
      getBox: () => [s.x - 6, -1.5, s.z - 6, s.x + 6, 17, s.z + 6],
    })));
    select.addProvider(() => [{
      kind: 'dragon', props: { speed: dragon.speed, altitude: dragon.alt }, source: src('life.js', 'Dragon'),
      getBox: () => { const p = dragon.pos, r = 22 * dragon.scale; return [p.x - r, p.y - 6, p.z - r, p.x + r, p.y + 8, p.z + r]; },
    }]);
    select.addProvider(() => folk.list.map((p, i) => ({
      kind: p.guard ? 'gold cloak' : 'townsfolk', id: `#${i}`, props: { walking: !p.still }, source: src('life.js', 'Folk'),
      getBox: () => [p.x - 0.4, p.y, p.z - 0.4, p.x + 0.4, p.y + 1.8, p.z + 0.4],
    })));
    select.addProvider(() => coins.items.filter((c) => !c.got).map((c) => ({
      kind: 'gold dragon', props: { where: c.where }, source: src('life.js', 'Coins'),
      getBox: () => [c.x - 0.8, c.y + 0.5, c.z - 0.8, c.x + 0.8, c.y + 2, c.z + 0.8],
    })));

    // ---------- live tweaks ----------
    tweaks.add('Dragon / Flight speed ×', { value: 100, min: 0, max: 150, step: 0.5, onChange: (v) => (dragon.speed = v) });
    tweaks.add('Dragon / Altitude', { value: 115, min: 40, max: 300, step: 1, onChange: (v) => (dragon.alt = v) });
    tweaks.add('Dragon / Circle radius', { value: 330, min: 120, max: 800, step: 5, onChange: (v) => (dragon.radius = v) });
    tweaks.add('Dragon / Size ×', { value: 1, min: 0.3, max: 3, step: 0.05, onChange: (v) => (dragon.scale = v) });
    tweaks.add('Dragon / Scale color', { value: '#221715', onChange: (v) => dragon.bodyMat.color.set(v) });
    tweaks.add('Dragon / Wing color', { value: '#3b1f1a', onChange: (v) => dragon.wingMat.color.set(v) });
    tweaks.add('City / Roof tint', { value: '#ffffff', onChange: (v) => city.mats.roof.color.set(v) });
    tweaks.add('City / Plaster tint', { value: '#ffffff', onChange: (v) => city.mats.wall.color.set(v) });
    tweaks.add('City / Window glow at night', { value: 1.2, min: 0, max: 4, step: 0.05, onChange: (v) => (windowGlow = v) });
    tweaks.add('City / Torch glow', { value: 1, min: 0, max: 3, step: 0.05, onChange: (v) => (torchGlow = v) });
    tweaks.add('City / Wall stone color', { value: '#dcc79e', onChange: (v) => mats.wall.color.set(v) });
    tweaks.add('Red Keep / Stone color', { value: '#b35a3f', onChange: (v) => mats.red.color.set(v) });
    tweaks.add('Red Keep / Roof color', { value: '#9a3a2a', onChange: (v) => mats.roofRed.color.set(v) });
    tweaks.add('Great Sept / Marble color', { value: '#f6f3ec', onChange: (v) => mats.marble.color.set(v) });
    tweaks.add('Great Sept / Gold color', { value: '#d9ab45', onChange: (v) => mats.gold.color.set(v) });
    tweaks.add('Dragonpit / Stone color', { value: '#bca98c', onChange: (v) => (pit.ringMat.color.set(v), mats.pit.color.set(v)) });
    tweaks.add('Bay / Water color', { value: '#2b5764', onChange: (v) => water.mat.color.set(v) });
    tweaks.add('Bay / Ship bobbing', { value: 1, min: 0, max: 4, step: 0.05, onChange: (v) => (ships.bob = v) });
    tweaks.add('People / Walking speed ×', { value: 1, min: 0, max: 3, step: 0.05, onChange: (v) => (folk.speedScale = v) });
    tweaks.add('Land / Ground tint', { value: '#ffffff', onChange: (v) => terrain.mat.color.set(v) });

    // ---------- HUD ----------
    hud.setMap({
      image: drawMap(city, piers),
      half: MAP_HALF,
      markers: () => [
        ...coins.items.filter((c) => !c.got).map((c) => ({ x: c.x, z: c.z, color: '#ffcf5a' })),
        { x: dragon.pos.x, z: dragon.pos.z, color: '#ff5a3a', size: 5 },
      ],
    });
    const visited = new Set();
    let district = '', districtT = 0, roarCd = 10, finished = false;
    const objective = () => hud.setObjective({ label: 'Gold dragons', value: coins.count, total: coins.total, sub: district });

    return {
      world: {
        grid,
        groundY,
        spawn: { x: PLAZA.x + 16, z: PLAZA.z + 8, yaw: Math.atan2(-(KEEP.x - PLAZA.x - 16), -(KEEP.z - PLAZA.z - 8)), pitch: 0.1 },
        limit: 2000,
      },

      attract(camera, t) {
        const a = 0.9 + t * 0.04;
        camera.position.set(60 + Math.cos(a) * 480, 170, -20 + Math.sin(a) * 480);
        camera.lookAt(KEEP.x - 40, 30, KEEP.z - 60);
      },

      update(dt, t, { player, started }) {
        folk.update(dt, t);
        dragon.update(dt, t);
        ships.update(dt, t);
        water.tex.offset.set(t * 0.004, t * 0.0025);
        const f = player.focus;
        const py = player.pos.y;
        if (!started) return;
        coins.update(dt, t, f.x, py, f.z, (c) => {
          audio.pickup();
          hud.toast(`Gold dragon found at ${c.where} <span style="color:#fff">${coins.count}/${coins.total}</span>`);
          if (coins.count === coins.total && !finished) {
            finished = true;
            audio.win();
            document.exitPointerLock?.();
            hud.modal({ kicker: "King's Landing", title: 'A Lannister pays his debts', html: 'You found every gold dragon hidden in the city. The Iron Bank would be proud.', button: 'Keep exploring' });
          }
        });
        if ((districtT -= dt) <= 0) {
          districtT = 0.4;
          const d = districtAt(f.x, f.z);
          if (d !== district) {
            district = d;
            if (!visited.has(d)) {
              visited.add(d);
              if (visited.size > 1) hud.toast(`<span style="color:#e8c170">${d}</span>`);
            }
          }
        }
        roarCd -= dt;
        if (roarCd <= 0 && audio.ctx && dragon.pos.distanceTo(player.pos) < 190) {
          roarCd = 35;
          audio.noise(2.2, 140, 'lowpass', 0.55);
          audio.tone(62, 0, 1.8, 0.18, 'sawtooth');
          audio.tone(48, 0.3, 1.6, 0.14, 'sawtooth');
        }
        objective();
      },

      onNight(n, t) {
        city.mats.wall.emissiveIntensity = n * windowGlow;
        const flick = 0.9 + Math.sin(t * 13) * 0.05 + Math.sin(t * 7.3) * 0.05;
        flameMat.opacity = Math.min(1, (0.35 + n * 0.65) * torchGlow);
        flameMat.size = 1.1 * flick;
        haloMat.opacity = Math.min(1, n * 0.5 * torchGlow);
        haloMat.size = 7 * flick;
      },

      prompt() {
        const p = ctx.player?.pos;
        if (!p) return '';
        const c = coins.items.find((c) => !c.got && Math.hypot(c.x - p.x, c.z - p.z) < 12);
        return c ? 'A gold dragon glints nearby' : '';
      },

      snapshot() {
        return { got: coins.items.map((c, i) => (c.got ? i : -1)).filter((i) => i >= 0), visited: [...visited], finished, dragonA: dragon.a };
      },

      restore(s) {
        for (const i of s.got || []) {
          const c = coins.items[i];
          if (c && !c.got) {
            c.got = true;
            c.g.visible = false;
            coins.count++;
          }
        }
        for (const v of s.visited || []) visited.add(v);
        finished = !!s.finished;
        if (typeof s.dragonA === 'number') dragon.a = s.dragonA;
      },

      debug: { city, keep, sept, pit, folk, dragon, coins, ships },
    };
  },
});
