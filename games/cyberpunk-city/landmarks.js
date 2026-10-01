import * as THREE from 'three';
import { GeoBuilder, smoothstep } from '../../engine/index.js';
import { mk, toTex } from '../../engine/world/textures.js';
import { FACADE_TW, FACADE_TH } from './textures.js';
import { quadAt, rgb } from './city.js';
import { terrainY, LAND_Y, TRAM_X, TRAM_Z0, TRAM_Z1, PEAK, PEAK_Y } from './layout.js';

function labelTex(lines, color, w = 1024, h = 256) {
  const c = mk(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#05040a';
  x.fillRect(0, 0, w, h);
  x.shadowColor = color;
  x.shadowBlur = 16;
  x.strokeStyle = color;
  x.lineWidth = 6;
  x.strokeRect(10, 10, w - 20, h - 20);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  lines.forEach(([text, size, col], i) => {
    x.font = `800 ${size}px "PingFang HK","Hiragino Sans","Futura","Avenir Next",sans-serif`;
    x.shadowColor = col;
    x.shadowBlur = size * 0.3;
    x.fillStyle = col;
    x.fillText(text, w / 2, (h * (i + 1)) / (lines.length + 1));
  });
  return toTex(c);
}
const FULL_UV = [0, 0, 1, 0, 1, 1, 0, 1];

export function buildLandmarks(scene, city, grid, T) {
  const face = new GeoBuilder(), roof = new GeoBuilder(), neon = new GeoBuilder(), ads = new GeoBuilder(), labels = new GeoBuilder();
  const neonBox = (x0, x1, y0, y1, z0, z1, hex) => neon.box(x0, x1, y0, y1, z0, z1, { col: rgb(hex) });
  const faceBox = (x0, x1, y0, y1, z0, z1) => face.box(x0, x1, y0, y1, z0, z1, { tw: FACADE_TW, th: FACADE_TH, topBuilder: roof, topCol: rgb('#3a3b40'), topScale: 0.12 });
  const edges = (x0, x1, z0, z1, y0, y1, hex) => {
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) neonBox(x - 0.35, x + 0.35, y0, y1, z - 0.35, z + 0.35, hex);
  };
  const ring = (x0, x1, z0, z1, y, hex, t = 0.8) => {
    neonBox(x0 - 0.3, x1 + 0.3, y, y + t, z0 - 0.3, z0 + 0.1, hex);
    neonBox(x0 - 0.3, x1 + 0.3, y, y + t, z1 - 0.1, z1 + 0.3, hex);
    neonBox(x0 - 0.3, x0 + 0.1, y, y + t, z0 - 0.3, z1 + 0.3, hex);
    neonBox(x1 - 0.1, x1 + 0.3, y, y + t, z0 - 0.3, z1 + 0.3, hex);
  };
  const parts = [];

  // ---------- Nexus Tower: the megacorp spire on the waterfront ----------
  const NX = { x: 24, z: -188 };
  const tiers = [
    { x0: 6, x1: 42, z0: -206, z1: -170, y0: LAND_Y - 1, h: 170 },
    { x0: 10, x1: 38, z0: -202, z1: -174, y0: 170, h: 290 },
    { x0: 14, x1: 34, z0: -198, z1: -178, y0: 290, h: 370 },
  ];
  for (const t of tiers) {
    faceBox(t.x0, t.x1, t.y0, t.h, t.z0, t.z1);
    edges(t.x0, t.x1, t.z0, t.z1, t.y0 + 4, t.h, '#05d9e8');
    ring(t.x0, t.x1, t.z0, t.z1, t.h - 0.8, '#05d9e8');
    for (let y = t.y0 + 30; y < t.h - 10; y += 40) ring(t.x0, t.x1, t.z0, t.z1, y, '#ff3cac', 0.5);
  }
  roof.box(NX.x - 1.5, NX.x + 1.5, 370, 440, NX.z - 1.5, NX.z + 1.5, { col: rgb('#2a2b30') });
  neonBox(NX.x - 1.7, NX.x + 1.7, 400, 401, NX.z - 1.7, NX.z + 1.7, '#ff3cac');
  neonBox(NX.x - 1.7, NX.x + 1.7, 420, 421, NX.z - 1.7, NX.z + 1.7, '#ff3cac');
  quadAt(ads, NX.x, -206.8, 0, -1, 17, 110, 127, [0, 0.75, 0.5, 0.75, 0.5, 1, 0, 1]);
  quadAt(ads, 42.8, NX.z, 1, 0, 15, 60, 75, [0.5, 0.5, 1, 0.5, 1, 0.75, 0.5, 0.75]);
  const nexusLabel = labelTex([['NEXUS', 150, '#7df9ff']], '#05d9e8', 1024, 256);
  grid.add({ x0: 6, x1: 42, z0: -206, z1: -170, h: 440, tiers: [...tiers.map(({ x0, x1, z0, z1, h }) => ({ x0, x1, z0, z1, h })), { x0: NX.x - 1.5, x1: NX.x + 1.5, z0: NX.z - 1.5, z1: NX.z + 1.5, h: 440 }] });
  parts.push({ kind: 'landmark tower', id: 'Nexus Tower', box: [6, 0, -206, 42, 440, -170], props: { height: 440 }, source: 'landmarks.js → buildLandmarks() → Nexus Tower' });
  city.buildings.push({ x0: 6, x1: 42, z0: -206, z1: -170, base: 0, h: 440, style: 'nexus', zone: 'downtown' });

  const holoMat = new THREE.MeshBasicMaterial({ map: T.holo, color: '#7df9ff', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const holoMat2 = holoMat.clone();
  holoMat2.color.set('#ff3cac');
  const holoA = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 14, 72, 1, true), holoMat);
  holoA.position.set(NX.x, 232, NX.z);
  const holoB = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 10, 64, 1, true), holoMat2);
  holoB.position.set(NX.x, 334, NX.z);
  scene.add(holoA, holoB);

  // ---------- Peak Tram: a funicular straight up the mountain ----------
  const STEP = 6;
  const raw = [];
  for (let z = TRAM_Z0; z <= TRAM_Z1 + 0.01; z += STEP) raw.push({ z, g: terrainY(TRAM_X, z) });
  const path = raw.map((p, k) => {
    let s = 0, n = 0;
    for (let d = -3; d <= 3; d++) {
      const q = raw[Math.min(raw.length - 1, Math.max(0, k + d))];
      s += q.g;
      n++;
    }
    return { z: p.z, g: p.g, y: Math.max(s / n, p.g + 1.2) + 1.5 };
  });
  for (let k = 1; k < path.length; k++) path[k].y = Math.max(path[k].y, path[k - 1].y);
  path[0].y = LAND_Y + 1.5;
  let len = 0;
  for (let k = 0; k < path.length; k++) {
    if (k) len += Math.hypot(path[k].z - path[k - 1].z, path[k].y - path[k - 1].y);
    path[k].s = len;
  }
  const trackCol = rgb('#3b3c40');
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k];
    const x0 = TRAM_X - 2.6, x1 = TRAM_X + 2.6;
    roof.quad([x0, a.y, a.z], [x1, a.y, a.z], [x1, b.y, b.z], [x0, b.y, b.z], 0, 1, 0, [0, 0, 1, 0, 1, 1, 0, 1], trackCol);
    roof.quad([x0, a.y - 1, a.z], [x0, a.y, a.z], [x0, b.y, b.z], [x0, b.y - 1, b.z], -1, 0, 0, [0, 0, 1, 0, 1, 1, 0, 1], trackCol);
    roof.quad([x1, a.y, a.z], [x1, a.y - 1, a.z], [x1, b.y - 1, b.z], [x1, b.y, b.z], 1, 0, 0, [0, 0, 1, 0, 1, 1, 0, 1], trackCol);
    for (const rx of [-0.9, 0.9]) {
      const c = rgb('#ff4040');
      neon.quad([TRAM_X + rx - 0.1, a.y + 0.15, a.z], [TRAM_X + rx + 0.1, a.y + 0.15, a.z], [TRAM_X + rx + 0.1, b.y + 0.15, b.z], [TRAM_X + rx - 0.1, b.y + 0.15, b.z], 0, 1, 0, FULL_UV, c);
    }
    if (k % 2 === 0 && a.y - a.g > 1.2) roof.box(TRAM_X - 1, TRAM_X + 1, a.g - 1, a.y - 1, a.z - 0.6, a.z + 0.6, { col: trackCol, top: false });
  }
  const posAt = (s) => {
    s = Math.max(0, Math.min(len, s));
    let k = 1;
    while (k < path.length - 1 && path[k].s < s) k++;
    const a = path[k - 1], b = path[k];
    const f = (s - a.s) / (b.s - a.s || 1);
    return { z: a.z + (b.z - a.z) * f, y: a.y + (b.y - a.y) * f, pitch: Math.atan2(b.y - a.y, b.z - a.z) };
  };

  // stations
  const lowY = LAND_Y, topY = path[path.length - 1].y - 1.5;
  const station = (z0, z1, y, name) => {
    faceBox(TRAM_X - 5.5, TRAM_X + 5.5, y - 1, y + 9, z0, z1);
    edges(TRAM_X - 5.5, TRAM_X + 5.5, z0, z1, y, y + 9, '#ff4040');
    grid.add({ x0: TRAM_X - 5.5, x1: TRAM_X - 3, z0, z1, h: y + 9 });
    grid.add({ x0: TRAM_X + 3, x1: TRAM_X + 5.5, z0, z1, h: y + 9 });
    parts.push({ kind: 'tram station', id: name, box: [TRAM_X - 5.5, y - 1, z0, TRAM_X + 5.5, y + 9, z1], props: { name }, source: 'landmarks.js → buildLandmarks() → Peak Tram' });
  };
  station(TRAM_Z0 - 16, TRAM_Z0 + 2, lowY, 'Garden Road terminus');
  station(TRAM_Z1 - 6, TRAM_Z1 + 12, topY, 'Peak terminus');
  const tramLabel = labelTex([['山頂纜車', 90, '#ffffff'], ['PEAK TRAM', 64, '#ff4040']], '#ff4040', 1024, 384);
  quadAt(labels, TRAM_X, TRAM_Z0 - 16.3, 0, -1, 5, lowY + 9.5, lowY + 13.2, FULL_UV);

  const tramMat = new THREE.MeshStandardMaterial({ color: '#9e1b1b', roughness: 0.5, metalness: 0.3 });
  const tramTop = new THREE.MeshStandardMaterial({ color: '#e6dcc2', roughness: 0.6 });
  const tramWin = new THREE.MeshStandardMaterial({ color: '#1a1a1a', emissive: '#ffe2a8', emissiveIntensity: 1.2 });
  const tram = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.6, 11), tramMat);
  body.position.y = 0.8;
  const upper = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.8, 11), tramTop);
  upper.position.y = 2.5;
  const win = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.9, 10.2), tramWin);
  win.position.y = 2.4;
  body.castShadow = upper.castShadow = true;
  tram.add(body, upper, win);
  scene.add(tram);
  const tramState = { s: 0, dir: 1, wait: 4, speed: 7, len };
  const placeTram = () => {
    const p = posAt(tramState.s);
    tram.position.set(TRAM_X, p.y + 0.2, p.z);
    tram.rotation.set(-p.pitch, 0, 0);
    return p;
  };
  placeTram();

  // ---------- Peak Tower: the wok-shaped lookout on the summit ----------
  const PT = { x: PEAK.x + 26, z: PEAK.z + 10 };
  const coreTop = PEAK_Y + 22;
  faceBox(PT.x - 9, PT.x + 9, PEAK_Y - 1, coreTop, PT.z - 9, PT.z + 9);
  edges(PT.x - 9, PT.x + 9, PT.z - 9, PT.z + 9, PEAK_Y, coreTop, '#b967ff');
  grid.add({ x0: PT.x - 9, x1: PT.x + 9, z0: PT.z - 9, z1: PT.z + 9, h: coreTop });
  const bowl = new THREE.LatheGeometry([[0, 0], [9, 0], [16, 1.2], [24, 3.6], [30, 7.2], [33, 10.5]].map(([r, y]) => new THREE.Vector2(r, y)), 48);
  const bowlMat = new THREE.MeshStandardMaterial({ color: '#b9bcc6', metalness: 0.75, roughness: 0.3, side: THREE.DoubleSide });
  const bowlMesh = new THREE.Mesh(bowl, bowlMat);
  bowlMesh.position.set(PT.x, coreTop, PT.z);
  bowlMesh.castShadow = true;
  const rimMat = new THREE.MeshBasicMaterial({ color: '#ff3cac' });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(33, 0.35, 6, 96), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(PT.x, coreTop + 10.5, PT.z);
  scene.add(bowlMesh, rim);
  parts.push({ kind: 'landmark', id: 'Peak Tower', box: [PT.x - 33, PEAK_Y, PT.z - 33, PT.x + 33, coreTop + 11, PT.z + 33], props: { summit: PEAK_Y }, source: 'landmarks.js → buildLandmarks() → Peak Tower' });
  city.buildings.push({ x0: PT.x - 9, x1: PT.x + 9, z0: PT.z - 9, z1: PT.z + 9, base: PEAK_Y, h: coreTop, style: 'peak', zone: 'hill' });
  const peakLabel = labelTex([['山頂  THE PEAK', 110, '#b967ff']], '#b967ff', 1024, 256);
  quadAt(labels, PT.x, PT.z - 9.3, 0, -1, 8, PEAK_Y + 10, PEAK_Y + 14, FULL_UV);
  const plazaLamps = [];
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) plazaLamps.push(PEAK.x + Math.cos(a) * (PEAK.r - 4), PEAK_Y + 4, PEAK.z + Math.sin(a) * (PEAK.r - 4));

  // ---------- meshes ----------
  const add = (b, m, shadow) => {
    const mesh = new THREE.Mesh(b.build(), m);
    mesh.castShadow = mesh.receiveShadow = !!shadow;
    scene.add(mesh);
    return mesh;
  };
  add(face, city.mats.cyber, true);
  add(roof, city.mats.roof, true);
  add(neon, city.mats.neon);
  add(ads, city.mats.ads);
  // one label mesh per texture
  const labelMats = [nexusLabel, tramLabel, peakLabel].map((map) => new THREE.MeshBasicMaterial({ map }));
  const lab = labels.build();
  lab.addGroup(0, 6, 1);
  lab.addGroup(6, 6, 2);
  const labelMesh = new THREE.Mesh(lab, labelMats);
  scene.add(labelMesh);
  const nexusSign = new THREE.Mesh(new THREE.PlaneGeometry(26, 6.5), labelMats[0]);
  nexusSign.position.set(NX.x, 160, -206.9);
  nexusSign.rotation.y = Math.PI;
  scene.add(nexusSign);
  const plazaGeo = new THREE.BufferGeometry();
  plazaGeo.setAttribute('position', new THREE.Float32BufferAttribute(plazaLamps, 3));
  const plazaMat = new THREE.PointsMaterial({ map: city.poolTex, color: '#d9b3ff', size: 10, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Points(plazaGeo, plazaMat));

  return {
    parts, tram, tramState, placeTram, posAt, path, PT, coreTop, NX, holoMat, holoMat2, labelMats, rimMat, tramWin, plazaMat,
    stations: { low: { z: TRAM_Z0 - 4, y: lowY }, top: { z: TRAM_Z1 + 8, y: topY } },
    update(dt, t) {
      holoA.rotation.y = t * 0.12;
      holoB.rotation.y = -t * 0.18;
      holoA.position.y = 232 + Math.sin(t * 0.6) * 1.5;
      const S = tramState;
      if (S.wait > 0) S.wait -= dt;
      else {
        S.s += S.dir * S.speed * dt * smoothstep(0, 12, Math.min(S.s, len - S.s) + 1.5);
        if (S.s >= len) (S.s = len, S.dir = -1, S.wait = 10, S.arrived = 'top');
        else if (S.s <= 0) (S.s = 0, S.dir = 1, S.wait = 10, S.arrived = 'low');
      }
      placeTram();
    },
    setNight(n, t) {
      const k = 0.6 + n * 1.6;
      holoMat.opacity = 0.25 + n * 0.65;
      holoMat2.opacity = 0.2 + n * 0.6;
      for (const m of labelMats) m.color.setScalar(k);
      rimMat.color.set('#ff3cac').multiplyScalar(0.8 + n * 2);
      tramWin.emissiveIntensity = 0.2 + n * 1.3;
      plazaMat.opacity = n;
    },
  };
}
