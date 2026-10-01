import * as THREE from 'three';
import { defineGame, CollisionGrid, createRng } from '../../engine/index.js';
import { makeTextures } from './textures.js';
import { buildTerrain, buildWater, buildReflections } from './terrain.js';
import { buildCity } from './city.js';
import { buildLandmarks } from './landmarks.js';
import { SkyTraffic, Harbour } from './traffic.js';
import { Rain, Shards } from './fx.js';
import { drawMap, MAP_HALF } from './map.js';
import {
  groundY, terrainY, natural, districtAt, LAND_Y, GX0, GZ0, CELL, FOOT_Z, SHORE_Z, KOWLOON_Z, PIER, PEAK, PEAK_Y, TRAM_X, TRAM_Z0, TRAM_Z1,
} from './layout.js';

// Neon Hong Kong: Victoria Harbour, a waterfront of megatowers, and the Mid-Levels
// climbing the mountain behind in terraces, with the Peak Tram running up to the summit.
export default defineGame({
  title: 'Cyberpunk city',
  controls: [['E', 'ride the Peak Tram'], ['M', 'map of the city']],

  async setup(ctx) {
    const { scene, hud, audio, tweaks, select, slug, env } = ctx;
    const src = (file, fn) => `games/${slug}/${file}${fn ? ` → ${fn}` : ''}`;
    const grid = new CollisionGrid(32);
    const T = makeTextures();

    env.time = 21.5;
    const terrain = buildTerrain(scene, T);
    const water = buildWater(scene, ctx.textures.waterNormal);
    const city = buildCity(scene, T, grid, ctx.textures);
    const lm = buildLandmarks(scene, city, grid, T);
    const refl = buildReflections(scene, T, city.buildings, createRng('reflections'));
    const traffic = new SkyTraffic(scene);
    const harbour = new Harbour(scene);
    const rain = new Rain(scene);

    // ---------- data shards ----------
    const hillTop = city.buildings.filter((b) => b.zone === 'hill' && b.style !== 'peak').sort((a, b) => b.h - a.h)[0];
    const at = (x, z, where) => ({ x, z, y: terrainY(x, z), where });
    const spots = [
      { x: 17, z: -195, y: 370, where: 'the roof of Nexus Tower' },
      { x: lm.PT.x, z: lm.PT.z, y: lm.coreTop, where: 'inside the bowl of the Peak Tower' },
      { x: (PIER.x0 + PIER.x1) / 2, z: KOWLOON_Z + 44, y: LAND_Y + 0.3, where: 'the Kowloon ferry pier' },
      { x: 340, z: KOWLOON_Z - 12, y: LAND_Y, where: 'the Kowloon promenade' },
      { x: TRAM_X, z: TRAM_Z0 - 24, y: LAND_Y, where: 'the Peak Tram terminus' },
      at(PEAK.x - 22, PEAK.z - 12, 'the Peak plaza'),
      { x: GX0 + 8 * CELL, z: GZ0 + 2 * CELL, y: LAND_Y, where: 'a Central back street' },
      { x: GX0 + 26 * CELL, z: GZ0 + 3 * CELL, y: LAND_Y, where: 'a Central back street' },
      at(GX0 + 6 * CELL, GZ0 + 6 * CELL, 'a Mid-Levels stairway'),
      at(GX0 + 13 * CELL, GZ0 + 8 * CELL, 'a Mid-Levels stairway'),
      at(GX0 + 23 * CELL, GZ0 + 5 * CELL, 'a Mid-Levels stairway'),
      { x: (hillTop.x0 + hillTop.x1) / 2, z: (hillTop.z0 + hillTop.z1) / 2, y: hillTop.h, where: 'the tallest rooftop in the Mid-Levels' },
    ];
    const shards = new Shards(scene, spots, ctx.textures);

    // ---------- point-and-prompt ----------
    for (const b of city.buildings) {
      if (b.style === 'nexus' || b.style === 'peak') continue;
      select.add({
        kind: b.kind || b.style, box: [b.x0, b.base, b.z0, b.x1, b.h, b.z1],
        props: { height: Math.round(b.h - b.base), style: b.style, district: b.zone, ...(b.embedded ? { sunkIntoSlope: true } : {}), ...(b.ad ? { billboard: true } : {}) },
        source: src('city.js', b.zone === 'hill' ? 'hillLot()' : b.zone === 'kowloon' ? 'buildCity() → Kowloon' : 'downtownLot()'),
      });
    }
    for (const p of lm.parts) select.add({ ...p, source: `games/${slug}/${p.source}` });
    for (let x = -1200; x < 1200; x += 96) {
      for (let z = FOOT_Z; z < 1300; z += 96) {
        const h = Math.min(natural(x, z), natural(x + 96, z), natural(x, z + 96), natural(x + 96, z + 96));
        if (h > 12) select.add({ kind: 'mountainside', box: [x, 0, z, x + 96, h, z + 96], props: { elevation: Math.round(h) }, source: src('layout.js', 'natural() / terrainY()') });
      }
    }
    select.add({ kind: 'Victoria Harbour', box: [-2600, -2, KOWLOON_Z, 2600, 0.2, SHORE_Z], props: {}, source: src('terrain.js', 'buildWater()') });
    select.add({ kind: 'Star Ferry pier', box: [PIER.x0, -1, PIER.z0, PIER.x1, LAND_Y + 11, PIER.z1], props: {}, source: src('city.js', 'buildCity() → harbourfront') });
    select.add({ kind: 'ground', box: [-2600, -10, SHORE_Z, 2600, LAND_Y, FOOT_Z + 20], props: {}, source: src('terrain.js', 'buildTerrain()') });
    select.addProvider(() => [{
      kind: 'Peak Tram', props: { speed: lm.tramState.speed, heading: lm.tramState.dir > 0 ? 'up' : 'down' }, source: src('landmarks.js', 'buildLandmarks() → Peak Tram'),
      getBox: () => { const p = lm.tram.position; return [p.x - 2, p.y - 1, p.z - 6, p.x + 2, p.y + 4, p.z + 6]; },
    }]);
    select.addProvider(() => traffic.cars.map((c, i) => ({
      kind: 'hover car', id: `#${i}`, props: { lane: c.L.axis === 'x' ? 'east-west' : 'harbour crossing', altitude: Math.round(c.y) }, source: src('traffic.js', 'SkyTraffic'),
      getBox: () => [c.x - 2.6, c.y - 0.2, c.z - 2.6, c.x + 2.6, c.y + 1.7, c.z + 2.6],
    })));
    select.addProvider(() => harbour.boats.map((b) => ({
      kind: b.kind, id: b.id, props: {}, source: src('traffic.js', 'Harbour'),
      getBox: () => [b.x - 8, -1, b.z - 15, b.x + 8, 8, b.z + 15],
    })));
    select.addProvider(() => shards.items.filter((s) => !s.got).map((s) => ({
      kind: 'data shard', props: { where: s.where }, source: src('fx.js', 'Shards'),
      getBox: () => [s.x - 1, s.y + 0.5, s.z - 1, s.x + 1, s.y + 2.8, s.z + 1],
    })));

    // ---------- live tweaks ----------
    let alwaysNight = false, hazeAmt = 0.45, hazeDensity = 1, dayHaze = 0.3;
    const haze = new THREE.Color('#3a1450'), smog = new THREE.Color('#9a9aa2');
    tweaks.add('Atmosphere / Always night (locks the clock)', { value: false, onChange: (v) => (alwaysNight = v) });
    tweaks.add('Atmosphere / Neon haze color', { value: '#3a1450', onChange: (v) => haze.set(v) });
    tweaks.add('Atmosphere / Neon haze amount', { value: 0.45, min: 0, max: 1, step: 0.01, onChange: (v) => (hazeAmt = v) });
    tweaks.add('Atmosphere / Haze density ×', { value: 1, min: 0.2, max: 3, step: 0.05, onChange: (v) => (hazeDensity = v) });
    tweaks.add('Atmosphere / Daytime smog', { value: 0.3, min: 0, max: 1, step: 0.01, onChange: (v) => (dayHaze = v) });
    tweaks.add('Weather / Rain', { value: 0.6, min: 0, max: 1, step: 0.01, onChange: (v) => (rain.amount = v) });
    tweaks.add('Weather / Rain color', { value: '#9fb6d8', onChange: (v) => rain.mat.color.set(v) });
    tweaks.add('Weather / Wet streets', { value: 0.5, min: 0, max: 1, step: 0.01, onChange: (v) => (terrain.mat.roughness = 0.92 - v * 0.7) });
    tweaks.add('City / Window glow', { value: 1, min: 0, max: 3, step: 0.05, onChange: (v) => (city.glow = v) });
    tweaks.add('City / Neon strip glow', { value: 1, min: 0, max: 3, step: 0.05, onChange: (v) => (city.neonGlow = v) });
    tweaks.add('City / Shop sign brightness', { value: 1, min: 0, max: 3, step: 0.05, onChange: (v) => (city.signGlow = v) });
    tweaks.add('City / Billboard brightness', { value: 1, min: 0, max: 3, step: 0.05, onChange: (v) => (city.adGlow = v) });
    tweaks.add('City / Street lamp glow', { value: 1, min: 0, max: 3, step: 0.05, onChange: (v) => (city.lampGlow = v) });
    tweaks.add('City / Residential tint', { value: '#ffffff', onChange: (v) => city.mats.hk.color.set(v) });
    tweaks.add('City / Tenement tint', { value: '#ffffff', onChange: (v) => city.mats.tenement.color.set(v) });
    tweaks.add('City / Office glass tint', { value: '#ffffff', onChange: (v) => city.mats.glass.color.set(v) });
    tweaks.add('City / Megacorp tint', { value: '#ffffff', onChange: (v) => city.mats.cyber.color.set(v) });
    tweaks.add('Nexus Tower / Hologram color', { value: '#7df9ff', onChange: (v) => lm.holoMat.color.set(v) });
    tweaks.add('Nexus Tower / Upper hologram color', { value: '#ff3cac', onChange: (v) => lm.holoMat2.color.set(v) });
    tweaks.add('Peak Tram / Speed', { value: 7, min: 1, max: 30, step: 0.5, onChange: (v) => (lm.tramState.speed = v) });
    tweaks.add('Sky traffic / Speed ×', { value: 1, min: 0, max: 3, step: 0.05, onChange: (v) => (traffic.speedScale = v) });
    tweaks.add('Harbour / Water color', { value: '#0b1c26', onChange: (v) => water.mat.color.set(v) });
    tweaks.add('Harbour / Neon reflections', { value: 0.35, min: 0, max: 1, step: 0.01, onChange: (v) => (refl.strength = v) });
    tweaks.add('Harbour / Ferry speed ×', { value: 1, min: 0, max: 4, step: 0.05, onChange: (v) => (harbour.speedScale = v) });
    tweaks.add('Land / Jungle tint', { value: '#ffffff', onChange: (v) => terrain.mat.color.set(v) });
    tweaks.add('Data shards / Beam opacity', { value: 0.5, min: 0, max: 1, step: 0.01, onChange: (v) => (shards.beamMat.opacity = v) });

    // ---------- HUD ----------
    hud.setMap({
      image: drawMap(city),
      half: MAP_HALF,
      markers: () => [
        ...shards.items.filter((s) => !s.got).map((s) => ({ x: s.x, z: s.z, color: '#ff3cac' })),
        { x: lm.tram.position.x, z: lm.tram.position.z, color: '#ff4040', size: 5 },
      ],
    });
    const visited = new Set();
    let district = '', districtT = 0, finished = false;
    const objective = () => hud.setObjective({ label: 'Data shards', value: shards.count, total: shards.total, sub: district });

    // ---------- riding the Peak Tram ----------
    let riding = false, wasFlying = false;
    const exits = { low: { x: TRAM_X, z: TRAM_Z0 - 22, yaw: Math.PI }, top: { x: PEAK.x - 10, z: TRAM_Z1 + 20, yaw: Math.PI } };
    const board = (player) => {
      riding = true;
      wasFlying = player.flying;
      player.flying = true;
      hud.toast('All aboard the <span style="color:#ff4040">Peak Tram</span>');
      audio.door();
    };
    const alight = (player, where) => {
      riding = false;
      player.flying = wasFlying;
      const e = where ? exits[where] : null;
      const p = lm.tram.position;
      const x = e ? e.x : p.x + 5, z = e ? e.z : p.z;
      player.teleport(x, groundY(x, z) + 0.2, z, e ? e.yaw : player.yaw, 0);
    };
    const nearTram = (p) => p.distanceTo(lm.tram.position) < 9;

    return {
      world: {
        grid,
        groundY,
        spawn: { x: TRAM_X, z: SHORE_Z + 10, yaw: Math.PI, pitch: 0.18 },
        limit: 1500,
      },

      attract(camera, t) {
        const a = t * 0.035;
        camera.position.set(Math.sin(a) * 520, 70 + Math.sin(a * 0.7) * 20, -640 + Math.cos(a) * 80);
        camera.lookAt(Math.sin(a) * 200, 150, 80);
      },

      update(dt, t, { player, started, mode }) {
        if (alwaysNight && env.time > 5 && env.time < 19.3) env.time = 19.3;
        lm.update(dt, t);
        traffic.update(dt, t);
        harbour.update(dt * (harbour.speedScale ?? 1), t);
        rain.update(dt, ctx.camera);
        water.tex.offset.set(t * 0.003, t * 0.002);
        const arrived = lm.tramState.arrived;
        lm.tramState.arrived = null;
        if (!started) return;
        if (riding) {
          const p = lm.tram.position;
          player.pos.set(p.x, p.y + 0.9, p.z);
          player.vel.set(0, 0, 0);
          if (arrived) {
            alight(player, arrived);
            hud.toast(arrived === 'top' ? 'The Peak' : 'Garden Road');
          }
        }
        const f = player.focus;
        shards.update(dt, t, f.x, player.pos.y, f.z, (s) => {
          audio.pickup();
          hud.toast(`Data shard pulled from ${s.where} <span style="color:#fff">${shards.count}/${shards.total}</span>`);
          if (shards.count === shards.total && !finished) {
            finished = true;
            audio.win();
            document.exitPointerLock?.();
            hud.modal({ kicker: 'Upload complete', title: 'The city remembers you', html: 'Every data shard is yours, from the harbour to the Peak. Nexus will be looking for you.', button: 'Keep exploring' });
          }
        });
        if ((districtT -= dt) <= 0) {
          districtT = 0.5;
          const d = districtAt(f.x, f.z, player.pos.y);
          if (d !== district) {
            district = d;
            if (!visited.has(d)) {
              visited.add(d);
              if (visited.size > 1) hud.toast(`<span style="color:#05d9e8">${d}</span>`);
            }
          }
        }
        if (mode === 'play') objective();
      },

      onNight(n, t) {
        city.setNight(n, t);
        lm.setNight(n, t);
        traffic.setNight(n);
        harbour.setNight(n);
        refl.mat.opacity = n * (refl.strength ?? 0.35);
        const fog = scene.fog;
        fog.color.lerp(smog, (1 - n) * dayHaze).lerp(haze, n * hazeAmt);
        fog.density *= hazeDensity;
      },

      prompt({ player }) {
        if (!player) return '';
        if (riding) return 'Riding the Peak Tram · <kbd>E</kbd> hop off';
        if (nearTram(player.pos)) return '<kbd>E</kbd> ride the Peak Tram';
        const s = shards.items.find((s) => !s.got && Math.hypot(s.x - player.pos.x, s.z - player.pos.z) < 14);
        return s ? 'A data shard hums nearby' : '';
      },

      onKey(code, { player }) {
        if (code !== 'KeyE') return;
        if (riding) alight(player, null);
        else if (nearTram(player.pos)) board(player);
      },

      snapshot() {
        const S = lm.tramState;
        return { got: shards.items.filter((s) => s.got).map((s) => s.i), visited: [...visited], finished, tram: { s: S.s, dir: S.dir, wait: S.wait }, riding, wasFlying };
      },

      restore(s) {
        for (const i of s.got || []) if (shards.items[i]) shards.take(shards.items[i]);
        for (const v of s.visited || []) visited.add(v);
        finished = !!s.finished;
        if (s.tram) Object.assign(lm.tramState, s.tram);
        lm.placeTram();
        if (s.riding) {
          riding = true;
          wasFlying = !!s.wasFlying;
          if (ctx.player) ctx.player.flying = true;
        }
      },

      debug: { city, lm, traffic, harbour, shards, rain, PEAK_Y },
    };
  },
});
