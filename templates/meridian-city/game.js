import { defineGame, buildMountains } from '../../engine/index.js';
import { makeCityTextures } from './textures.js';
import { buildCity } from './city.js';
import { Vehicles } from './vehicles.js';
import { Peds } from './peds.js';
import { Cores } from './cores.js';
import { drawCityMap, MAP_HALF } from './map.js';
import { WORLD_LIMIT } from './config.js';

export default defineGame({
  title: 'Meridian City',
  controls: [['E', 'enter / exit car'], ['H', 'horn']],

  async setup(ctx) {
    const { scene, hud, audio, tweaks, select, slug } = ctx;
    const src = (file, fn) => `games/${slug}/${file}${fn ? ` → ${fn}` : ''}`;

    const T = makeCityTextures(ctx.textures);
    const city = buildCity(scene, T);
    buildMountains(scene);
    const vehicles = new Vehicles(scene, { ai: 420, parked: city.parked });
    const peds = new Peds(scene, city.blocks, 900);
    const cores = new Cores(scene, city.cores, T);

    // ---------- point-and-prompt ----------
    city.buildings.forEach((b, i) => {
      const tower = b.style === 'tower';
      select.add({
        kind: tower ? 'landmark tower' : 'building',
        id: tower ? 'central tower' : `#${i}`,
        box: [b.x0, 0, b.z0, b.x1, b.h, b.z1],
        props: { height: b.h, style: b.style, tiers: b.tiers?.length ?? 1 },
        source: src(tower ? 'city.js' : 'city.js', tower ? 'plazaBlock()' : 'addBuilding() / cityBlock()'),
      });
    });
    for (const b of city.blocks) {
      select.add({
        kind: b.type === 'park' ? 'park' : b.type === 'plaza' ? 'plaza' : 'city block',
        id: `block ${b.i},${b.j}`,
        box: [b.x0, 0, b.z0, b.x1, 0.3, b.z1],
        props: { type: b.type },
        source: src('city.js', b.type === 'park' ? 'parkBlock()' : b.type === 'plaza' ? 'plazaBlock()' : 'cityBlock()'),
      });
    }
    select.addProvider(() =>
      vehicles.list.map((v) => ({
        kind: v.mode === 'ai' ? 'traffic car' : v.mode === 'player' ? 'your car' : 'parked car',
        id: `car ${v.k}`,
        props: { color: v.color, speed: Math.abs(v.speed || 0) },
        source: src('vehicles.js', 'Vehicles'),
        getBox: () => {
          const c = Math.abs(Math.cos(v.heading)), s = Math.abs(Math.sin(v.heading));
          const ex = c * v.hx + s * v.hz, ez = s * v.hx + c * v.hz;
          return [v.x - ex, v.y, v.z - ez, v.x + ex, v.y + 1.6 * v.sc[1], v.z + ez];
        },
      })),
    );
    select.addProvider(() =>
      peds.list.map((p, i) => ({
        kind: 'pedestrian',
        id: `ped ${i}`,
        props: { speed: Math.abs(p.sp) },
        source: src('peds.js', 'Peds'),
        getBox: () => [p.x - 0.3, 0.2, p.z - 0.3, p.x + 0.3, 1.8, p.z + 0.3],
      })),
    );
    select.addProvider(() =>
      cores.items.filter((c) => !c.got).map((c) => ({
        kind: 'data core',
        props: { collected: false },
        source: src('cores.js', 'Cores'),
        getBox: () => [c.x - 1.3, c.y + 0.4, c.z - 1.3, c.x + 1.3, c.y + 2.8, c.z + 1.3],
      })),
    );

    // ---------- live tweaks ----------
    tweaks.add('Traffic / Car speed ×', { value: 1, min: 0, max: 3, step: 0.05, onChange: (v) => (vehicles.speedScale = v) });
    tweaks.add('Traffic / Pedestrian speed ×', { value: 1, min: 0, max: 3, step: 0.05, onChange: (v) => (peds.speedScale = v) });
    tweaks.add('City / Window glow at night', { value: 0.75, min: 0, max: 3, step: 0.05, onChange: (v) => (city.glow = v) });
    tweaks.add('Cores / Beam opacity', { value: 0.55, min: 0, max: 1, step: 0.01, onChange: (v) => (cores.beamMat.opacity = v) });
    tweaks.add('Cores / Beam color', { value: '#3cf2ff', onChange: (v) => cores.beamMat.color.set(v) });

    // ---------- HUD ----------
    hud.setMap({
      image: drawCityMap(city),
      half: MAP_HALF,
      markers: () => cores.items.filter((c) => !c.got).map((c) => ({ x: c.x, z: c.z, color: '#3cf2ff' })),
    });
    let elapsed = 0;
    let finished = false;
    const clock = () => `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;
    const objective = () => hud.setObjective({ label: 'Data cores', value: cores.count, total: cores.total, sub: clock() });

    const tower = city.towerTop;
    return {
      world: {
        grid: city.grid,
        groundY: city.groundY,
        spawn: { x: city.spawn.x, z: city.spawn.z, yaw: Math.PI * 0.92, pitch: 0.04 },
        limit: WORLD_LIMIT,
      },
      vehicles,

      attract(camera, t) {
        const a = 0.6 + t * 0.05;
        camera.position.set(Math.cos(a) * 520, 230, Math.sin(a) * 520);
        camera.lookAt(tower.x, 90, tower.z);
      },

      update(dt, t, { player, started, mode }) {
        const walker = !started || player.driving || player.altitude > 2.5 ? null : player.pos;
        vehicles.update(dt, walker);
        peds.update(dt, t);
        if (mode === 'play' && !finished) elapsed += dt;

        const f = player.focus;
        const py = player.driving ? player.car.y : player.pos.y;
        cores.update(dt, t, f.x, started ? py : -99, f.z, player.driving ? 3.6 : 2.4, () => {
          audio.pickup();
          hud.toast(`Core acquired <span style="color:#fff">${cores.count}/${cores.total}</span>`);
          if (cores.count === cores.total && !finished) {
            finished = true;
            audio.win();
            document.exitPointerLock?.();
            hud.modal({
              kicker: 'City scanned',
              title: 'All cores found',
              html: `You found every data core in <b>${clock()}</b>. The city is yours.`,
              button: 'Keep exploring',
            });
          }
        });
        for (const ev of vehicles.events) {
          const d = Math.hypot(ev.x - f.x, ev.z - f.z);
          if (d < 60) audio.horn(Math.max(0.15, 1 - d / 60) * 0.7);
        }
        vehicles.events.length = 0;
        if (started) objective();
      },

      onNight(n, t) {
        city.setNight(n, t);
        vehicles.setNight(n);
      },

      snapshot() {
        return { elapsed, finished, got: cores.items.filter((c) => c.got).map((c) => [c.x, c.z]) };
      },

      restore(s) {
        elapsed = s.elapsed || 0;
        finished = !!s.finished;
        for (const [x, z] of s.got || []) {
          const it = cores.items.find((c) => !c.got && Math.hypot(c.x - x, c.z - z) < 1);
          if (it) {
            it.got = true;
            it.g.visible = false;
            cores.count++;
          }
        }
      },

      debug: { city, vehicles, peds, cores },
    };
  },
});
