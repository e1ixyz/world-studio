import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

// Canvas-texture helpers shared by every game, plus a few generic textures.
export const mk = (w, h = w) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d', { willReadFrequently: true });
  return c;
};

let ANISO = 8;
export const setAnisotropy = (a) => (ANISO = Math.min(8, a || 8));

export function toTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = ANISO;
  return t;
}

export function grain(ctx, w, h, amt, rnd) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amt;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

export function blotches(ctx, w, h, n, colors, rnd, rmin, rmax, alpha) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = alpha * (0.4 + rnd() * 0.6);
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    ctx.beginPath();
    ctx.arc(rnd() * w, rnd() * h, rmin + rnd() * (rmax - rmin), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function radial(inner = 'rgba(255,255,255,1)') {
  const c = mk(128);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function beam() {
  const c = mk(4, 128);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, '#888888');
  g.addColorStop(1, '#000000');
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function waterNormal() {
  const S = 256;
  const c = mk(S);
  const x = c.getContext('2d');
  const img = x.createImageData(S, S);
  // many small waves with integer frequencies so the tile wraps seamlessly without looking regular
  const rnd = mulberry32(5);
  const waves = [];
  for (let k = 0; k < 28; k++) {
    const kx = Math.round((rnd() - 0.5) * 26), ky = Math.round((rnd() - 0.5) * 26);
    if (!kx && !ky) continue;
    waves.push([kx, ky, rnd() * Math.PI * 2, 1 / Math.hypot(kx, ky)]);
  }
  const h = (i, j) => {
    const u = (i / S) * Math.PI * 2;
    const v = (j / S) * Math.PI * 2;
    let sum = 0;
    for (const [kx, ky, ph, a] of waves) sum += Math.sin(u * kx + v * ky + ph) * a;
    return sum * 3;
  };
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const dx = h(i + 1, j) - h(i - 1, j);
      const dy = h(i, j + 1) - h(i, j - 1);
      const n = new THREE.Vector3(-dx * 2.2, -dy * 2.2, 1).normalize();
      const k = (j * S + i) * 4;
      img.data[k] = (n.x * 0.5 + 0.5) * 255;
      img.data[k + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[k + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return toTex(c, false);
}


// Ground grid for blank worlds: 256 px = 8 m, a fine grid with a stronger line every 8 m.
export function gridGround(base = '#5d6b58') {
  const rnd = mulberry32(3);
  const c = mk(256);
  const x = c.getContext('2d');
  x.fillStyle = base;
  x.fillRect(0, 0, 256, 256);
  blotches(x, 256, 256, 60, ['#56644f', '#65735f', '#5a6955'], rnd, 4, 20, 0.35);
  grain(x, 256, 256, 14, rnd);
  x.fillStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i < 256; i += 32) {
    x.fillRect(i, 0, 1, 256);
    x.fillRect(0, i, 256, 1);
  }
  x.fillStyle = 'rgba(255,255,255,0.2)';
  x.fillRect(0, 0, 2, 256);
  x.fillRect(0, 0, 256, 2);
  return toTex(c);
}

export function makeBaseTextures(maxAniso) {
  setAnisotropy(maxAniso);
  return {
    pool: radial(),
    beam: beam(),
    waterNormal: waterNormal(),
    grid: gridGround(),
  };
}
