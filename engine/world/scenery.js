import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { smoothstep } from '../core/math.js';

// Distant scenery gets thinner fog than the streets, so it stays visible as a hazy silhouette.
export function hazeFog(mat, scale) {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `#ifdef USE_FOG
        float hd = fogDensity * ${scale.toFixed(3)};
        float fogFactor = 1.0 - exp( - hd * hd * vFogDepth * vFogDepth );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
      #endif`
    );
  };
  mat.customProgramCacheKey = () => `haze${scale}`;
  return mat;
}

function valueNoise(seed) {
  const rnd = mulberry32(seed);
  const N = 256;
  const perm = new Uint8Array(N * 2);
  const vals = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    perm[i] = i;
    vals[i] = rnd();
  }
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < N; i++) perm[i + N] = perm[i];
  const at = (x, y) => vals[perm[(perm[x & 255] + y) & 511]];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1; // [-1, 1]
  };
}

// Ring of mountains across the water, all the way around the island.
export function buildMountains(scene) {
  const n1 = valueNoise(7), n2 = valueNoise(8);
  const ridged = (x, z) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < 6; o++) {
      const r = 1 - Math.abs(n1(x * freq, z * freq));
      sum += r * r * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  };
  const fbm = (x, z) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < 4; o++) {
      sum += n2(x * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };

  const R0 = 2100, R1 = 5600;
  const RINGS = 64, SEGS = 480;
  const pos = [], col = [], idx = [];
  const heights = [];
  for (let i = 0; i <= RINGS; i++) {
    const t = Math.pow(i / RINGS, 1.35); // denser near the shore
    const r = R0 + (R1 - R0) * t;
    for (let j = 0; j < SEGS; j++) {
      const a = (j / SEGS) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      // mountain range strength varies around the ring: tall peaks in places, low hills in others
      const range = 0.45 + 0.75 * (fbm(Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6 + 5) * 0.5 + 0.5);
      const rise = smoothstep(0, 0.28, t) * (1 - smoothstep(0.8, 1, t) * 0.35);
      const shoreJitter = fbm(x / 400, z / 400) * 0.08;
      const h = (rise + shoreJitter) * range * ridged(x / 1400, z / 1400) * 1500 - 45;
      heights.push(h);
      pos.push(x, h, z);
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGS; j++) {
      const a = i * SEGS + j, b = i * SEGS + ((j + 1) % SEGS);
      const c = a + SEGS, d = b + SEGS;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  const sand = new THREE.Color('#bfae86');
  const grass = new THREE.Color('#40592f');
  const forest = new THREE.Color('#2f4527');
  const rock = new THREE.Color('#6d675f');
  const darkRock = new THREE.Color('#4f4b46');
  const snow = new THREE.Color('#f1f4f8');
  const nrm = g.attributes.normal;
  const c = new THREE.Color();
  for (let k = 0; k < heights.length; k++) {
    const h = heights[k];
    const up = nrm.getY(k);
    const x = pos[k * 3], z = pos[k * 3 + 2];
    const jitter = fbm(x / 120, z / 120);
    c.copy(sand);
    c.lerp(grass, smoothstep(2, 14, h));
    c.lerp(forest, smoothstep(40, 160, h) * 0.8);
    c.lerp(rock, smoothstep(220 + jitter * 60, 420, h));
    c.lerp(darkRock, smoothstep(0.8, 0.55, up) * smoothstep(60, 200, h));
    c.lerp(snow, smoothstep(720 + jitter * 110, 860, h) * smoothstep(0.55, 0.8, up));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();

  const mat = hazeFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), 0.3);
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}
