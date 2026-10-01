import { terrainY, insideWalls, WALL, ROADS, GATES, KEEP, SEPT, PIT, PLAZA, FISH } from './layout.js';

// Top-down map for the minimap and the big map (M).
export const MAP_HALF = 620;
const IMG = 2048;
const S = IMG / (2 * MAP_HALF);
const tx = (v) => (v + MAP_HALF) * S;

export function drawMap(city, piers) {
  const base = document.createElement('canvas');
  const N = 512;
  base.width = base.height = N;
  const b = base.getContext('2d');
  const img = b.createImageData(N, N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * 2 * MAP_HALF - MAP_HALF, z = ((j + 0.5) / N) * 2 * MAP_HALF - MAP_HALF;
      const y = terrainY(x, z);
      let r, g, bl;
      if (y < 0) [r, g, bl] = [38, 74, 88];
      else if (y < 1.6) [r, g, bl] = [196, 182, 142];
      else if (insideWalls(x, z)) [r, g, bl] = [150, 132, 104];
      else [r, g, bl] = [98, 116, 66];
      const k = 0.85 + Math.min(0.3, Math.max(0, y) / 90);
      const o = (j * N + i) * 4;
      img.data[o] = r * k;
      img.data[o + 1] = g * k;
      img.data[o + 2] = bl * k;
      img.data[o + 3] = 255;
    }
  }
  b.putImageData(img, 0, 0);

  const c = document.createElement('canvas');
  c.width = c.height = IMG;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = true;
  x.drawImage(base, 0, 0, IMG, IMG);

  x.lineCap = x.lineJoin = 'round';
  x.strokeStyle = '#6d6252';
  for (const r of ROADS) {
    x.lineWidth = r.w * S;
    x.beginPath();
    r.pts.forEach(([px, pz], i) => (i ? x.lineTo(tx(px), tx(pz)) : x.moveTo(tx(px), tx(pz))));
    x.stroke();
  }
  x.fillStyle = '#7a6e5c';
  for (const sq of [PLAZA, FISH]) {
    x.beginPath();
    x.arc(tx(sq.x), tx(sq.z), sq.r * S, 0, Math.PI * 2);
    x.fill();
  }
  for (const h of city.houses) {
    x.fillStyle = h.flea ? '#8a6a4a' : '#b0593c';
    x.fillRect(tx(h.x0), tx(h.z0), (h.x1 - h.x0) * S, (h.z1 - h.z0) * S);
  }
  x.fillStyle = '#7b5a3a';
  for (const p of piers) x.fillRect(tx(p.x - 2.5), tx(p.z0), 5 * S, (p.z1 - p.z0) * S);

  x.strokeStyle = '#d9c9a3';
  x.lineWidth = 5 * S;
  x.beginPath();
  WALL.forEach(([px, pz], i) => (i ? x.lineTo(tx(px), tx(pz)) : x.moveTo(tx(px), tx(pz))));
  x.closePath();
  x.stroke();
  x.fillStyle = '#e8dcc0';
  for (const t of city.wallTowers) {
    x.beginPath();
    x.arc(tx(t.x), tx(t.z), t.r * S, 0, Math.PI * 2);
    x.fill();
  }

  x.fillStyle = '#8e3a2a';
  x.fillRect(tx(KEEP.x - KEEP.half), tx(KEEP.z - KEEP.half), KEEP.half * 2 * S, KEEP.half * 2 * S);
  x.fillStyle = '#b5705a';
  x.fillRect(tx(KEEP.x - KEEP.half + 5), tx(KEEP.z - KEEP.half + 5), (KEEP.half - 5) * 2 * S, (KEEP.half - 5) * 2 * S);
  x.fillStyle = '#8e3a2a';
  x.fillRect(tx(182), tx(110), 32 * S, 32 * S);
  x.fillStyle = '#f4f1ea';
  x.beginPath();
  x.arc(tx(SEPT.x), tx(SEPT.z), 36 * S, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#d4a743';
  x.beginPath();
  x.arc(tx(SEPT.x), tx(SEPT.z), 17 * S, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = '#8c7a62';
  x.lineWidth = 3 * S;
  x.beginPath();
  x.arc(tx(PIT.x), tx(PIT.z), PIT.r * S, 0, Math.PI * 2);
  x.stroke();

  x.fillStyle = '#f3ead2';
  x.font = `600 ${Math.round(IMG / 90)}px Georgia, serif`;
  x.textAlign = 'center';
  x.shadowColor = 'rgba(0,0,0,0.7)';
  x.shadowBlur = 6;
  const label = (t, px, pz) => x.fillText(t, tx(px), tx(pz));
  label('The Red Keep', KEEP.x, KEEP.z - KEEP.half - 10);
  label('Great Sept of Baelor', SEPT.x, SEPT.z - 52);
  label('Dragonpit', PIT.x, PIT.z - PIT.r - 10);
  label('Flea Bottom', -110, 70);
  label('Blackwater Bay', 60, 420);
  label('Blackwater Rush', -440, -300);
  x.font = `${Math.round(IMG / 130)}px Georgia, serif`;
  for (const g of GATES) label(g.name, g.x + g.nx * 34, g.z + g.nz * 34);
  return c;
}
