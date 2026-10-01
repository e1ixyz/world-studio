import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);

// World-space UVs so textures keep their real-world scale on big boxes.
export function projectUV(g, s) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    if (Math.abs(ny) > 0.6) uv.setXY(i, p.getX(i) / s, p.getZ(i) / s);
    else {
      const l = Math.hypot(nx, nz) || 1;
      uv.setXY(i, (p.getX(i) * -nz + p.getZ(i) * nx) / l / s, p.getY(i) / s);
    }
  }
  return g;
}

// Collects primitive geometry per material key and merges each key into one mesh.
export class Kit {
  constructor() {
    this.g = new Map();
  }

  add(key, geo) {
    let a = this.g.get(key);
    if (!a) this.g.set(key, (a = []));
    a.push(geo.index ? geo.toNonIndexed() : geo);
    return geo;
  }

  place(key, geo, x, y, z, rotY = 0) {
    geo.applyMatrix4(M.compose(V.set(x, y, z), Q.setFromAxisAngle(UP, rotY), S));
    return this.add(key, geo);
  }

  // Box by center x/z, bottom y0 and top y1.
  box(key, w, d, x, y0, y1, z, rotY = 0, s = 3) {
    const g = new THREE.BoxGeometry(w, y1 - y0, d);
    g.applyMatrix4(M.compose(V.set(x, (y0 + y1) / 2, z), Q.setFromAxisAngle(UP, rotY), S));
    projectUV(g, s);
    return this.add(key, g);
  }

  // Cylinder / cone / frustum standing on y0.
  cyl(key, rTop, rBot, x, y0, y1, z, seg = 16, { s = 3, open = false, theta = 0 } = {}) {
    const h = y1 - y0;
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open, theta);
    const uv = g.attributes.uv, r = Math.max(rTop, rBot);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 2 * Math.PI * r) / s, (uv.getY(i) * h) / s);
    g.translate(x, y0 + h / 2, z);
    return this.add(key, g);
  }

  build(scene, mats, { cast = true, receive = true } = {}) {
    const meshes = {};
    for (const [k, arr] of this.g) {
      const geo = mergeGeometries(arr, false);
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mats[k]);
      m.castShadow = cast;
      m.receiveShadow = receive;
      scene.add(m);
      meshes[k] = m;
    }
    this.g.clear();
    return meshes;
  }
}

// Quad or triangle (d === c) with a normal computed from its corners.
export function face(B, a, b, c, d, uv, col) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  B.quad(a, b, c, d, nx / l, ny / l, nz / l, uv, col);
}
