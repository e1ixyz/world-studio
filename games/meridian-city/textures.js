import * as THREE from 'three';
import { mulberry32 } from '../../engine/core/rng.js';
import { mk, toTex, grain, blotches } from '../../engine/world/textures.js';

// Facade tile = 8 columns x 8 floors. Each column is 3 m wide, each floor 3.6 m tall.
export const FACADE_TW = 24;
export const FACADE_TH = 28.8;

const STYLES = {
  glass: {
    wall: '#5d6670',
    glass: ['#2d4459', '#35506a', '#27394b', '#3b5870'],
    winW: 0.96,
    winH: 0.8,
    lit: 0.34,
    mullion: '#4a525a',
  },
  office: {
    wall: '#cfc8bb',
    glass: ['#37424e', '#2f3945', '#3e4a57'],
    winW: 0.7,
    winH: 0.52,
    lit: 0.4,
    sill: '#b3ab9d',
  },
  brick: {
    wall: '#9a5642',
    glass: ['#2e2b29', '#383230', '#2a2c30'],
    winW: 0.38,
    winH: 0.5,
    lit: 0.48,
    brick: true,
    sill: '#c9b9a4',
  },
  modern: {
    wall: '#3c4046',
    glass: ['#1e2730', '#25303b', '#1a222b'],
    winW: 0.84,
    winH: 0.66,
    lit: 0.32,
    mullion: '#2c3036',
  },
};

const LIT = ['#ffd99a', '#fff0cf', '#ffe2b0', '#d6ebff', '#ffc27a', '#fff8e8'];

function facade(style, seed) {
  const st = STYLES[style];
  const rnd = mulberry32(seed);
  const S = 512;
  const N = 8;
  const C = S / N;
  const col = mk(S);
  const emi = mk(S);
  const rough = mk(S);
  const cc = col.getContext('2d');
  const ec = emi.getContext('2d');
  const rc = rough.getContext('2d');

  cc.fillStyle = st.wall;
  cc.fillRect(0, 0, S, S);
  if (st.brick) {
    for (let y = 0; y < S; y += 6) {
      const off = (y / 6) % 2 ? 7 : 0;
      for (let x = -off; x < S; x += 14) {
        const v = 0.85 + rnd() * 0.3;
        cc.fillStyle = `rgb(${154 * v | 0},${86 * v | 0},${66 * v | 0})`;
        cc.fillRect(x, y, 13, 5);
      }
    }
  }
  grain(cc, S, S, 18, rnd);
  ec.fillStyle = '#000';
  ec.fillRect(0, 0, S, S);
  rc.fillStyle = 'rgb(225,225,225)';
  rc.fillRect(0, 0, S, S);

  // floor slab lines
  cc.fillStyle = 'rgba(0,0,0,0.18)';
  for (let r = 0; r < N; r++) cc.fillRect(0, r * C + C - 3, S, 3);

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const x = c * C;
      const y = r * C;
      const ww = C * st.winW;
      const wh = C * st.winH;
      const wx = x + (C - ww) / 2;
      const wy = y + (C - wh) * 0.45;
      const base = st.glass[Math.floor(rnd() * st.glass.length)];
      const g = cc.createLinearGradient(0, wy, 0, wy + wh);
      g.addColorStop(0, '#6f8499');
      g.addColorStop(0.35, base);
      g.addColorStop(1, base);
      cc.fillStyle = g;
      cc.fillRect(wx, wy, ww, wh);
      if (st.mullion) {
        cc.fillStyle = st.mullion;
        cc.fillRect(wx + ww / 2 - 1, wy, 2, wh);
        cc.fillRect(wx, wy, 2, wh);
      }
      if (st.sill) {
        cc.fillStyle = st.sill;
        cc.fillRect(wx - 2, wy + wh, ww + 4, 3);
      }
      rc.fillStyle = 'rgb(35,35,35)';
      rc.fillRect(wx, wy, ww, wh);

      if (rnd() < st.lit) {
        ec.globalAlpha = 0.45 + rnd() * 0.55;
        ec.fillStyle = LIT[Math.floor(rnd() * LIT.length)];
        const blind = rnd() < 0.3 ? rnd() * 0.55 : 0;
        ec.fillRect(wx + 1, wy + 1 + wh * blind, ww - 2, wh * (1 - blind) - 2);
        ec.globalAlpha = 1;
      }
    }
  }
  return { map: toTex(col), emissiveMap: toTex(emi), roughnessMap: toTex(rough, false) };
}

function asphalt(ctx, S, rnd) {
  ctx.fillStyle = '#37393d';
  ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, S, 40, ['#2c2e31', '#3f4145', '#303236'], rnd, 4, 22, 0.35);
  grain(ctx, S, S, 22, rnd);
}

function road(rnd) {
  // 256 px across = 16 m, 256 px along = 16 m
  const S = 256;
  const c = mk(S);
  const x = c.getContext('2d');
  asphalt(x, S, rnd);
  // tire wear on the travel lanes
  x.fillStyle = 'rgba(20,20,22,0.22)';
  for (const lane of [-1.8, 1.8]) for (const w of [-0.8, 0.8]) x.fillRect(128 + (lane + w) * 16 - 6, 0, 12, S);
  // gutters
  x.fillStyle = 'rgba(0,0,0,0.25)';
  x.fillRect(0, 0, 7, S);
  x.fillRect(S - 7, 0, 7, S);
  // double yellow
  x.fillStyle = '#d8b23c';
  x.fillRect(122, 0, 4, S);
  x.fillRect(130, 0, 4, S);
  // parking lane lines
  x.fillStyle = '#d9d9d4';
  x.fillRect(128 - 3.6 * 16 - 2, 0, 3, S);
  x.fillRect(128 + 3.6 * 16 - 1, 0, 3, S);
  grain(x, S, S, 14, rnd);
  return toTex(c);
}

function intersection(rnd) {
  const S = 256;
  const c = mk(S);
  const x = c.getContext('2d');
  asphalt(x, S, rnd);
  x.fillStyle = 'rgba(20,20,22,0.15)';
  x.beginPath();
  x.arc(128, 128, 60, 0, Math.PI * 2);
  x.fill();
  return toTex(c);
}

function crosswalk(rnd) {
  // 16 m across x 4 m deep, transparent between stripes
  const c = mk(256, 64);
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 64);
  x.fillStyle = '#e6e6e0';
  for (let s = 6; s < 250; s += 20) x.fillRect(s, 8, 11, 48);
  // wear
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 260; i++) {
    x.globalAlpha = rnd() * 0.8;
    x.fillRect(rnd() * 256, rnd() * 64, 2 + rnd() * 5, 2 + rnd() * 3);
  }
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  const t = toTex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function sidewalk(rnd) {
  const S = 256; // 4 m
  const c = mk(S);
  const x = c.getContext('2d');
  x.fillStyle = '#a7a59e';
  x.fillRect(0, 0, S, S);
  blotches(x, S, S, 30, ['#9a988f', '#b3b1aa', '#8f8d86'], rnd, 3, 16, 0.3);
  grain(x, S, S, 16, rnd);
  x.fillStyle = 'rgba(60,58,54,0.35)';
  for (let i = 0; i < S; i += 64) {
    x.fillRect(i, 0, 2, S);
    x.fillRect(0, i, S, 2);
  }
  return toTex(c);
}

function grass(rnd) {
  const S = 256;
  const c = mk(S);
  const x = c.getContext('2d');
  x.fillStyle = '#4b7a31';
  x.fillRect(0, 0, S, S);
  blotches(x, S, S, 120, ['#3e6a28', '#5a8b3b', '#46752e', '#6b9644'], rnd, 3, 18, 0.35);
  grain(x, S, S, 30, rnd);
  return toTex(c);
}

function roof(rnd) {
  const S = 256;
  const c = mk(S);
  const x = c.getContext('2d');
  x.fillStyle = '#737170';
  x.fillRect(0, 0, S, S);
  blotches(x, S, S, 60, ['#646261', '#82807d', '#5a5856'], rnd, 4, 26, 0.3);
  grain(x, S, S, 40, rnd);
  return toTex(c);
}


// City textures on top of the engine's base set (pool, beam, waterNormal, grid).
export function makeCityTextures(base) {
  const rnd = mulberry32(99);
  return {
    ...base,
    facade: {
      glass: facade('glass', 11),
      office: facade('office', 22),
      brick: facade('brick', 33),
      modern: facade('modern', 44),
    },
    road: road(rnd),
    intersection: intersection(rnd),
    crosswalk: crosswalk(rnd),
    sidewalk: sidewalk(rnd),
    grass: grass(rnd),
    roof: roof(rnd),
  };
}
