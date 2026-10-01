import { CITY_EDGE, PROMENADE } from './config.js';

// Top-down map image for the engine's minimap and big map (M).
export const MAP_HALF = CITY_EDGE + PROMENADE + 30; // half-extent of the image in world units
const W = MAP_HALF;
const IMG = 2048;
const S = IMG / (2 * W);

export function drawCityMap(city) {
  const c = document.createElement('canvas');
  c.width = c.height = IMG;
  const x = c.getContext('2d');
  const tx = (v) => (v + W) * S;
  x.fillStyle = '#0d2533';
  x.fillRect(0, 0, IMG, IMG);
  const P = CITY_EDGE + PROMENADE;
  x.fillStyle = '#5a5f66';
  x.fillRect(tx(-P), tx(-P), 2 * P * S, 2 * P * S);
  x.fillStyle = '#1f2227';
  x.fillRect(tx(-CITY_EDGE), tx(-CITY_EDGE), 2 * CITY_EDGE * S, 2 * CITY_EDGE * S);
  for (const b of city.blocks) {
    x.fillStyle = b.type === 'plaza' ? '#8c7a57' : '#62666d';
    x.fillRect(tx(b.x0), tx(b.z0), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S);
    if (b.type === 'park') {
      x.fillStyle = '#3d7a39';
      x.fillRect(tx(b.x0 + 4), tx(b.z0 + 4), (b.x1 - b.x0 - 8) * S, (b.z1 - b.z0 - 8) * S);
    }
  }
  x.fillStyle = '#3f8fb0';
  for (const p of city.ponds) {
    x.beginPath();
    x.arc(tx(p.x), tx(p.z), p.r * S, 0, Math.PI * 2);
    x.fill();
  }
  for (const b of city.buildings) {
    const k = Math.min(1, b.h / 180);
    const l = 150 + k * 80;
    x.fillStyle = b.style === 'tower' ? '#ffd76a' : `rgb(${l * 0.86 | 0},${l * 0.9 | 0},${l | 0})`;
    x.fillRect(tx(b.x0), tx(b.z0), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S);
  }
  return c;
}

