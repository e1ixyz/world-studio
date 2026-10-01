import { natural, TRAM_X, TRAM_Z0, TRAM_Z1, PIER, KOWLOON_Z } from './layout.js';

// Top-down map for the minimap and big map (M).
export const MAP_HALF = 1100;
const IMG = 2048;
const S = IMG / (2 * MAP_HALF);

export function drawMap(city) {
  const c = document.createElement('canvas');
  c.width = c.height = IMG;
  const x = c.getContext('2d');
  const tx = (v) => (v + MAP_HALF) * S;
  x.fillStyle = '#061822';
  x.fillRect(0, 0, IMG, IMG);
  // land shaded by elevation
  const N = 220, cell = (2 * MAP_HALF) / N;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const wx = -MAP_HALF + (i + 0.5) * cell, wz = -MAP_HALF + (j + 0.5) * cell;
      const y = natural(wx, wz);
      if (y < 0.5) continue;
      const k = Math.min(1, y / 380);
      x.fillStyle = `rgb(${28 + k * 30 | 0},${44 + k * 50 | 0},${36 + k * 28 | 0})`;
      x.fillRect(tx(wx - cell / 2), tx(wz - cell / 2), cell * S + 1, cell * S + 1);
    }
  }
  for (const b of city.buildings) {
    const k = Math.min(1, (b.h - b.base) / 220);
    x.fillStyle = b.style === 'nexus' || b.style === 'peak' ? '#ff3cac'
      : b.style === 'cyber' ? `rgb(${60 + k * 60 | 0},${70 + k * 90 | 0},${110 + k * 110 | 0})`
      : `rgb(${110 + k * 90 | 0},${110 + k * 90 | 0},${118 + k * 90 | 0})`;
    x.fillRect(tx(b.x0), tx(b.z0), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S);
  }
  x.fillStyle = '#7a7b80';
  x.fillRect(tx(PIER.x0), tx(PIER.z0), (PIER.x1 - PIER.x0) * S, (PIER.z1 - PIER.z0) * S);
  x.fillRect(tx(PIER.x0), tx(KOWLOON_Z - 2), (PIER.x1 - PIER.x0) * S, 52 * S);
  x.strokeStyle = '#ff4040';
  x.lineWidth = 4;
  x.beginPath();
  x.moveTo(tx(TRAM_X), tx(TRAM_Z0));
  x.lineTo(tx(TRAM_X), tx(TRAM_Z1));
  x.stroke();
  return c;
}
