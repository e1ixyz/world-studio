import * as THREE from 'three';
import { textures as TX, mulberry32 } from '../../engine/index.js';

const { mk, toTex, grain, blotches } = TX;

// Canvas textures for the city. Most are near-white so vertex colors / material colors tint them.
export function makeTextures() {
  const rnd = mulberry32(1066);
  return {
    ...plaster(rnd),
    roof: roofTiles(rnd),
    stone: stoneBlocks(rnd, '#d9d3c8', '#8f877b'),
    marble: marble(rnd),
    cobble: cobble(rnd),
    detail: groundDetail(rnd),
    wood: planks(rnd),
    arches: arches(rnd),
    lannister: banner('#8e1616', '#d9aa3a', 'lion'),
    baratheon: banner('#d8b030', '#1a1a1a', 'stag'),
  };
}

// House wall: 4 window bays across (16 m), one storey (3.1 m) high. Bays 0 and 2 are lit at night.
export const WALL_TW = 16, WALL_TH = 3.1;
function plaster(rnd) {
  const W = 512, H = 128;
  const c = mk(W, H), x = c.getContext('2d');
  const e = mk(W, H), ex = e.getContext('2d');
  x.fillStyle = '#ece5d6';
  x.fillRect(0, 0, W, H);
  blotches(x, W, H, 220, ['#dcd2bf', '#f4efe4', '#d2c6b0', '#e3dac8'], rnd, 3, 18, 0.5);
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, W, H);
  x.fillStyle = '#6e5238';
  x.fillRect(0, 0, W, 7);
  for (let i = 0; i < 4; i++) {
    const cx = i * 128 + 64, wx = cx - 15, wy = 32, ww = 30, wh = 54;
    const shape = (g, pad = 0) => {
      g.beginPath();
      g.moveTo(wx - pad, wy + wh + pad);
      g.lineTo(wx - pad, wy + 15);
      g.arc(cx, wy + 15, 15 + pad, Math.PI, 0);
      g.lineTo(wx + ww + pad, wy + wh + pad);
      g.closePath();
      g.fill();
    };
    x.fillStyle = i % 2 ? '#55705f' : '#7c4c2b';
    x.fillRect(wx - 15, wy + 6, 11, wh - 6);
    x.fillRect(wx + ww + 4, wy + 6, 11, wh - 6);
    x.fillStyle = '#b8a589';
    shape(x, 3);
    x.fillStyle = '#1d1711';
    shape(x);
    x.fillStyle = '#b3a283';
    x.fillRect(wx - 6, wy + wh + 3, ww + 12, 5);
    if (i === 0 || i === 2 || i === 3) {
      ex.fillStyle = i === 3 ? '#6a3c16' : '#ffb35c';
      shape(ex);
    }
  }
  grain(x, W, H, 16, rnd);
  const map = toTex(c);
  const emissive = toTex(e);
  return { plaster: map, plasterGlow: emissive };
}

function roofTiles(rnd) {
  const S = 256, c = mk(S), x = c.getContext('2d');
  x.fillStyle = '#6d625b';
  x.fillRect(0, 0, S, S);
  const rows = 8, cols = 8, rh = S / rows, cw = S / cols;
  for (let r = 0; r < rows; r++) {
    for (let k = -1; k <= cols; k++) {
      const ox = (r % 2) * cw * 0.5 + k * cw;
      const l = 200 + rnd() * 45;
      const g = x.createLinearGradient(ox, 0, ox + cw, 0);
      g.addColorStop(0, `rgb(${l * 0.62},${l * 0.6},${l * 0.58})`);
      g.addColorStop(0.45, `rgb(${l},${l * 0.97},${l * 0.93})`);
      g.addColorStop(1, `rgb(${l * 0.55},${l * 0.52},${l * 0.5})`);
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(ox + 2, r * rh);
      x.lineTo(ox + cw - 2, r * rh);
      x.lineTo(ox + cw - 2, r * rh + rh - 4);
      x.quadraticCurveTo(ox + cw / 2, r * rh + rh + 3, ox + 2, r * rh + rh - 4);
      x.fill();
    }
  }
  blotches(x, S, S, 50, ['#5a524c', '#fff'], rnd, 6, 26, 0.12);
  grain(x, S, S, 14, rnd);
  return toTex(c);
}

function stoneBlocks(rnd, base, mortar) {
  const S = 256, c = mk(S), x = c.getContext('2d');
  x.fillStyle = mortar;
  x.fillRect(0, 0, S, S);
  const rh = 32;
  for (let r = 0; r < S / rh; r++) {
    let px = -rnd() * 60;
    while (px < S) {
      const w = 44 + rnd() * 50;
      const l = 0.86 + rnd() * 0.18;
      const col = new THREE.Color(base).multiplyScalar(l);
      x.fillStyle = `#${col.getHexString()}`;
      x.fillRect(px + 1.5, r * rh + 1.5, w - 3, rh - 3);
      if (px + w > S) x.fillRect(px + 1.5 - S, r * rh + 1.5, w - 3, rh - 3);
      px += w;
    }
  }
  blotches(x, S, S, 90, ['#bdb4a6', '#efeae2', '#a89f92'], rnd, 4, 22, 0.25);
  grain(x, S, S, 18, rnd);
  return toTex(c);
}

function marble(rnd) {
  const S = 256, c = mk(S), x = c.getContext('2d');
  x.fillStyle = '#f3f1ec';
  x.fillRect(0, 0, S, S);
  x.strokeStyle = 'rgba(150,145,140,0.18)';
  for (let i = 0; i < 14; i++) {
    x.lineWidth = 0.5 + rnd() * 1.5;
    x.beginPath();
    let px = rnd() * S, py = rnd() * S;
    x.moveTo(px, py);
    for (let k = 0; k < 6; k++) x.lineTo((px += (rnd() - 0.5) * 80), (py += rnd() * 50));
    x.stroke();
  }
  x.fillStyle = 'rgba(160,155,148,0.35)';
  for (let r = 0; r < 4; r++) x.fillRect(0, r * 64, S, 1.5);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 2; k++) x.fillRect(((r % 2) * 64 + k * 128) % S, r * 64, 1.5, 64);
  grain(x, S, S, 8, rnd);
  return toTex(c);
}

function cobble(rnd) {
  const S = 256, c = mk(S), x = c.getContext('2d');
  x.fillStyle = '#5d5448';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const px = rnd() * S, py = rnd() * S, r = 5 + rnd() * 7;
    const l = 105 + rnd() * 55;
    x.fillStyle = `rgb(${l + 12},${l + 4},${l - 8})`;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      x.beginPath();
      x.ellipse(px + ox, py + oy, r, r * (0.7 + rnd() * 0.3), rnd() * 3, 0, Math.PI * 2);
      x.fill();
    }
  }
  blotches(x, S, S, 40, ['#4a4238', '#8a7d69'], rnd, 10, 40, 0.2);
  grain(x, S, S, 16, rnd);
  return toTex(c);
}

function groundDetail(rnd) {
  const S = 256, c = mk(S), x = c.getContext('2d');
  x.fillStyle = '#f0f0f0';
  x.fillRect(0, 0, S, S);
  blotches(x, S, S, 260, ['#d6d6d6', '#ffffff', '#c8c8c8', '#e2e2e2'], rnd, 2, 14, 0.55);
  grain(x, S, S, 28, rnd);
  return toTex(c);
}

function planks(rnd) {
  const S = 128, c = mk(S), x = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    const l = 0.8 + rnd() * 0.3;
    x.fillStyle = `rgb(${138 * l},${104 * l},${70 * l})`;
    x.fillRect(i * 16, 0, 16, S);
    x.fillStyle = 'rgba(40,25,12,0.8)';
    x.fillRect(i * 16, 0, 1.5, S);
    x.fillRect(i * 16, rnd() * S, 16, 1.5);
  }
  grain(x, S, S, 22, rnd);
  return toTex(c);
}

// Dragonpit ring: two tiers of arches cut out with alpha. One tile = 4 arches.
function arches(rnd) {
  const W = 512, H = 256, c = mk(W, H), x = c.getContext('2d');
  x.fillStyle = '#d7cdbd';
  x.fillRect(0, 0, W, H);
  blotches(x, W, H, 160, ['#b9ad99', '#e8e0d2', '#9d917e', '#6f6657'], rnd, 4, 30, 0.35);
  x.fillStyle = 'rgba(90,80,65,0.5)';
  for (let y = 0; y < H; y += 16) x.fillRect(0, y, W, 1.5);
  grain(x, W, H, 20, rnd);
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 4; i++) {
    const cx = i * 128 + 64;
    for (const [top, h, hw] of [[26, 70, 34], [132, 98, 40]]) {
      const broken = rnd() < 0.3;
      x.beginPath();
      x.moveTo(cx - hw, top + h);
      x.lineTo(cx - hw, top + hw);
      x.arc(cx, top + hw, hw, Math.PI, 0);
      x.lineTo(cx + hw, top + h);
      x.closePath();
      x.fill();
      if (broken) x.fillRect(cx - hw - 10, 0, hw * 2 + 20, top + 6);
    }
  }
  x.globalCompositeOperation = 'source-over';
  const t = toTex(c);
  return t;
}

function banner(field, charge, kind) {
  const W = 64, H = 160, c = mk(W, H), x = c.getContext('2d');
  x.fillStyle = field;
  x.fillRect(0, 0, W, H);
  x.fillStyle = charge;
  x.fillRect(0, 0, W, 6);
  x.fillRect(0, 0, 4, H - 20);
  x.fillRect(W - 4, 0, 4, H - 20);
  // swallowtail
  x.globalCompositeOperation = 'destination-out';
  x.beginPath();
  x.moveTo(0, H);
  x.lineTo(W / 2, H - 26);
  x.lineTo(W, H);
  x.fill();
  x.globalCompositeOperation = 'source-over';
  x.fillStyle = charge;
  x.strokeStyle = charge;
  const cy = 62;
  if (kind === 'lion') {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      x.beginPath();
      x.moveTo(32 + Math.cos(a) * 10, cy + Math.sin(a) * 10);
      x.lineTo(32 + Math.cos(a + 0.26) * 22, cy + Math.sin(a + 0.26) * 22);
      x.lineTo(32 + Math.cos(a + 0.52) * 10, cy + Math.sin(a + 0.52) * 10);
      x.fill();
    }
    x.beginPath();
    x.arc(32, cy, 12, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = field;
    x.fillRect(26, cy - 3, 3, 3);
    x.fillRect(35, cy - 3, 3, 3);
  } else {
    x.lineWidth = 3.5;
    x.lineCap = 'round';
    x.beginPath();
    x.ellipse(32, cy + 14, 7, 11, 0, 0, Math.PI * 2);
    x.fill();
    for (const s of [-1, 1]) {
      x.beginPath();
      x.moveTo(32 + s * 4, cy + 4);
      x.quadraticCurveTo(32 + s * 22, cy - 2, 32 + s * 16, cy - 26);
      x.moveTo(32 + s * 14, cy - 6);
      x.lineTo(32 + s * 24, cy - 12);
      x.moveTo(32 + s * 17, cy - 16);
      x.lineTo(32 + s * 8, cy - 22);
      x.stroke();
    }
  }
  const t = toTex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
