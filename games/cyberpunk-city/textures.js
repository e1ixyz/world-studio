import * as THREE from 'three';
import { mulberry32 } from '../../engine/index.js';
import { mk, toTex, grain, blotches } from '../../engine/world/textures.js';

// Facade tile = 8 columns x 8 floors; a column is 3 m wide, a floor 3.1 m tall.
export const FACADE_TW = 24;
export const FACADE_TH = 24.8;

export const NEON = ['#ff2a6d', '#05d9e8', '#f9f871', '#ff8b3d', '#b967ff', '#39ff88', '#ff3cac', '#00f0ff', '#ff4040', '#7df9ff'];
const CJK_FONT = '"PingFang HK","PingFang TC","Hiragino Sans","Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei",sans-serif';

const STYLES = {
  // Hong Kong residential: pale concrete, small windows, AC units, laundry
  hk: { wall: '#bdb6aa', glass: ['#2d3438', '#353c40', '#262b2e'], winW: 0.5, winH: 0.46, lit: 0.5, ac: true, lights: ['#e6f4ff', '#fff2cf', '#d9ffe9', '#ffe0a8', '#f0f0ff'] },
  // office glass
  glass: { wall: '#1f2b36', glass: ['#1b2a38', '#22364a', '#172431'], winW: 0.96, winH: 0.84, lit: 0.36, mullion: '#2c3a47', lights: ['#dbeeff', '#f4f8ff', '#bfe2ff', '#fff4dc'] },
  // dark megacorp panels with thin strip windows
  cyber: { wall: '#16181e', glass: ['#0d1016', '#121620', '#0a0c12'], winW: 0.9, winH: 0.22, lit: 0.42, panel: true, lights: ['#7df9ff', '#ff3cac', '#e8f7ff', '#b967ff', '#e8f7ff', '#05d9e8'] },
  // old stained tenement blocks
  tenement: { wall: '#8a7f6e', glass: ['#26231f', '#2c2824', '#211f1c'], winW: 0.56, winH: 0.52, lit: 0.58, stains: true, bars: true, ac: true, lights: ['#ffd99a', '#c8ffb0', '#fff0cf', '#ffc27a', '#b0e8ff'] },
};

function facade(style, seed) {
  const st = STYLES[style];
  const rnd = mulberry32(seed);
  const S = 512, N = 8, C = S / N;
  const col = mk(S), emi = mk(S), rough = mk(S);
  const cc = col.getContext('2d'), ec = emi.getContext('2d'), rc = rough.getContext('2d');
  cc.fillStyle = st.wall;
  cc.fillRect(0, 0, S, S);
  if (st.stains) {
    blotches(cc, S, S, 80, ['#6d6454', '#9a8f7c', '#5c5446'], rnd, 6, 40, 0.3);
    for (let i = 0; i < 40; i++) {
      const g = cc.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, 'rgba(40,34,28,0.35)');
      g.addColorStop(1, 'rgba(40,34,28,0)');
      cc.fillStyle = g;
      cc.fillRect(rnd() * S, rnd() * S * 0.5, 2 + rnd() * 6, S * (0.2 + rnd() * 0.6));
    }
  }
  if (st.panel) {
    cc.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c += 2) cc.strokeRect(c * C + 1, r * C + 1, C * 2 - 2, C - 2);
  }
  grain(cc, S, S, style === 'cyber' ? 8 : 18, rnd);
  ec.fillStyle = '#000';
  ec.fillRect(0, 0, S, S);
  rc.fillStyle = style === 'glass' || style === 'cyber' ? 'rgb(110,110,110)' : 'rgb(230,230,230)';
  rc.fillRect(0, 0, S, S);
  cc.fillStyle = 'rgba(0,0,0,0.22)';
  for (let r = 0; r < N; r++) cc.fillRect(0, r * C + C - 3, S, 3);

  for (let r = 0; r < N; r++) {
    // cyber towers light whole floors in bands of colour
    const floorLit = st.panel && rnd() < 0.18 ? st.lights[Math.floor(rnd() * st.lights.length)] : null;
    for (let c = 0; c < N; c++) {
      const x = c * C, y = r * C;
      const ww = C * st.winW, wh = C * st.winH;
      const wx = x + (C - ww) / 2, wy = y + (C - wh) * 0.42;
      cc.fillStyle = st.glass[Math.floor(rnd() * st.glass.length)];
      cc.fillRect(wx, wy, ww, wh);
      if (st.mullion) {
        cc.fillStyle = st.mullion;
        cc.fillRect(wx, wy, 2, wh);
        cc.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      }
      if (st.bars) {
        cc.fillStyle = 'rgba(30,28,26,0.8)';
        for (let b = 1; b < 5; b++) cc.fillRect(wx + (ww * b) / 5, wy, 1.5, wh);
      }
      rc.fillStyle = 'rgb(30,30,30)';
      rc.fillRect(wx, wy, ww, wh);
      if (st.ac && rnd() < 0.5) {
        // air-con box under the window, sometimes with laundry on a pole
        cc.fillStyle = rnd() < 0.5 ? '#d9d6cf' : '#a9a69f';
        cc.fillRect(wx + ww * 0.1, wy + wh + 3, C * 0.34, C * 0.2);
        cc.fillStyle = 'rgba(0,0,0,0.35)';
        cc.fillRect(wx + ww * 0.1, wy + wh + 3 + C * 0.2, C * 0.34, 2);
        if (rnd() < 0.3) {
          cc.fillStyle = ['#c24a4a', '#3d6fb0', '#e8e2d0', '#6aa05a', '#d9b64a'][Math.floor(rnd() * 5)];
          cc.fillRect(wx + ww * 0.55, wy + wh * 0.3, C * 0.14, C * 0.3);
        }
      }
      const lit = floorLit || (rnd() < st.lit ? st.lights[Math.floor(rnd() * st.lights.length)] : null);
      if (lit) {
        ec.globalAlpha = floorLit ? 0.9 : 0.45 + rnd() * 0.55;
        ec.fillStyle = lit;
        const blind = rnd() < 0.25 ? rnd() * 0.5 : 0;
        ec.fillRect(wx + 1, wy + 1 + wh * blind, ww - 2, wh * (1 - blind) - 2);
        ec.globalAlpha = 1;
      }
    }
  }
  return { map: toTex(col), emissiveMap: toTex(emi), roughnessMap: toTex(rough, false) };
}

function glowText(x, text, cx, cy, size, color, font = CJK_FONT, weight = 'bold') {
  x.font = `${weight} ${size}px ${font}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.shadowColor = color;
  x.shadowBlur = size * 0.35;
  x.fillStyle = color;
  x.fillText(text, cx, cy);
  x.shadowBlur = size * 0.12;
  x.fillStyle = '#ffffff';
  x.globalAlpha = 0.55;
  x.fillText(text, cx, cy);
  x.globalAlpha = 1;
  x.shadowBlur = 0;
}

function tube(x, x0, y0, w, h, color, lw = 5) {
  x.shadowColor = color;
  x.shadowBlur = 14;
  x.strokeStyle = color;
  x.lineWidth = lw;
  x.strokeRect(x0, y0, w, h);
  x.shadowBlur = 0;
}

// 16 vertical blade signs (128 x 512 cells) in the classic Hong Kong style.
const VWORDS = ['酒吧', '夜市', '電子', '麻雀館', '按摩', '茶餐廳', '大押', '拉麵', '賓館', '藥房', '網吧', '龍城', '金行', '桑拿', '中藥', '義體'];
function verticalSigns(rnd) {
  const c = mk(1024, 1024);
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, 1024, 1024);
  VWORDS.forEach((w, k) => {
    const x0 = (k % 8) * 128, y0 = Math.floor(k / 8) * 512;
    const color = NEON[k % NEON.length];
    x.fillStyle = rnd() < 0.5 ? '#0a0610' : '#120508';
    x.fillRect(x0 + 6, y0 + 6, 116, 500);
    tube(x, x0 + 12, y0 + 12, 104, 488, color, 4);
    const chars = [...w];
    const step = 440 / chars.length;
    const size = Math.min(96, step * 0.82);
    chars.forEach((ch, i) => glowText(x, ch, x0 + 64, y0 + 36 + step * (i + 0.5), size, k % 3 === 0 ? '#ffffff' : color));
  });
  return toTex(c);
}

// 16 horizontal shop signs (512 x 128 cells).
const HWORDS = [['NOODLE BAR', '麵'], ['HOTEL 24H', '酒店'], ['KARAOKE', '卡拉OK'], ['CYBERDECK', '改裝'], ['BAR', '夜'], ['PAWN', '押'], ['NEURO-LINK', '神經'], ['CHROME', '鉻'], ['NETCAFE', '網'], ['DRAGON', '龍'], ['MAHJONG', '雀'], ['SYNTH', '合成'], ['STAR FERRY', '天星'], ['CLINIC', '診所'], ['LUCKY 88', '發'], ['RAMEN', '拉麵']];
function horizontalSigns(rnd) {
  const c = mk(1024, 1024);
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, 1024, 1024);
  HWORDS.forEach(([en, zh], k) => {
    const x0 = (k % 2) * 512, y0 = Math.floor(k / 2) * 128;
    const color = NEON[(k * 3 + 1) % NEON.length];
    const alt = NEON[(k * 3 + 4) % NEON.length];
    x.fillStyle = '#07060b';
    x.fillRect(x0 + 5, y0 + 5, 502, 118);
    tube(x, x0 + 10, y0 + 10, 492, 108, alt, 3);
    glowText(x, zh, x0 + 78, y0 + 64, 64, alt);
    glowText(x, en, x0 + 300, y0 + 66, en.length > 8 ? 46 : 58, color, '"Futura","Avenir Next Condensed","Arial Narrow",sans-serif', '800');
  });
  return toTex(c);
}

// 8 big billboards (512 x 256 cells) for tower faces.
const ADS = [
  ['KAIRO OPTICS', '光學義眼', '#05d9e8', '#1a0433'],
  ['LUCKY 88', '幸運賭場', '#ffd23f', '#3a0008'],
  ['NEON LOTUS', '霓虹蓮', '#ff3cac', '#08001a'],
  ['ORBITAL BANK', '軌道銀行', '#7df9ff', '#001a24'],
  ['SYNAPSE+', '神經加速', '#b967ff', '#05000e'],
  ['DRAGON NOODLE', '龍麵', '#ff8b3d', '#1d0600'],
  ['JADE PHARMA', '翡翠藥業', '#39ff88', '#001409'],
  ['MOTHERBOARD', '母板科技', '#ff2a6d', '#0a0014'],
];
function billboards(rnd) {
  const c = mk(1024, 1024);
  const x = c.getContext('2d');
  ADS.forEach(([en, zh, color, bg], k) => {
    const x0 = (k % 2) * 512, y0 = Math.floor(k / 2) * 256;
    const g = x.createLinearGradient(x0, y0, x0 + 512, y0 + 256);
    g.addColorStop(0, bg);
    g.addColorStop(1, '#000');
    x.fillStyle = g;
    x.fillRect(x0, y0, 512, 256);
    x.save();
    x.beginPath();
    x.rect(x0, y0, 512, 256);
    x.clip();
    x.globalAlpha = 0.5;
    x.strokeStyle = color;
    x.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      x.beginPath();
      x.arc(x0 + 400 + rnd() * 60, y0 + 128, 30 + i * 22, 0, Math.PI * 2);
      x.stroke();
    }
    x.globalAlpha = 0.18;
    x.fillStyle = color;
    for (let i = 0; i < 256; i += 6) x.fillRect(x0, y0 + i, 512, 2);
    x.globalAlpha = 1;
    x.restore();
    glowText(x, zh, x0 + 200, y0 + 92, 70, '#ffffff');
    glowText(x, en, x0 + 200, y0 + 180, en.length > 11 ? 40 : 50, color, '"Futura","Avenir Next","Arial Black",sans-serif', '800');
    tube(x, x0 + 8, y0 + 8, 496, 240, color, 3);
  });
  return toTex(c);
}

// Rotating hologram ribbon around Nexus Tower.
function holoRibbon() {
  const c = mk(2048, 128);
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, 2048, 128);
  x.globalAlpha = 0.35;
  x.fillStyle = '#05d9e8';
  for (let i = 0; i < 128; i += 5) x.fillRect(0, i, 2048, 1);
  x.globalAlpha = 1;
  for (let k = 0; k < 4; k++) {
    glowText(x, 'NEXUS', 180 + k * 512, 66, 76, '#7df9ff', '"Futura","Avenir Next","Arial Black",sans-serif', '800');
    glowText(x, '連結', 400 + k * 512, 64, 70, '#ff3cac');
  }
  const t = toTex(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Wet-looking reflection streaks for the harbour surface.
function streak(rnd) {
  const c = mk(64, 256);
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 2) {
    const k = 1 - y / 256;
    const w = 20 + rnd() * 30;
    x.fillStyle = `rgba(255,255,255,${(k * k * (0.4 + rnd() * 0.6)).toFixed(3)})`;
    x.fillRect(32 - w / 2 + (rnd() - 0.5) * 10, y, w, 1);
  }
  const t = toTex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function detail(rnd) {
  const c = mk(256);
  const x = c.getContext('2d');
  x.fillStyle = '#b0b0b0';
  x.fillRect(0, 0, 256, 256);
  blotches(x, 256, 256, 90, ['#999', '#c4c4c4', '#a4a4a4'], rnd, 4, 22, 0.4);
  grain(x, 256, 256, 30, rnd);
  return toTex(c);
}

export function makeTextures() {
  const rnd = mulberry32(88);
  return {
    facade: { hk: facade('hk', 1), glass: facade('glass', 2), cyber: facade('cyber', 3), tenement: facade('tenement', 4) },
    vsigns: verticalSigns(rnd),
    hsigns: horizontalSigns(rnd),
    ads: billboards(rnd),
    holo: holoRibbon(),
    streak: streak(rnd),
    detail: detail(rnd),
  };
}
