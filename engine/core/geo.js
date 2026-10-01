import * as THREE from 'three';

const WHITE = [1, 1, 1];

// Accumulates quads into one big BufferGeometry so a whole district is a single draw call.
export class GeoBuilder {
  constructor() {
    this.p = [];
    this.n = [];
    this.u = [];
    this.c = [];
    this.i = [];
    this.v = 0;
  }

  get empty() {
    return this.v === 0;
  }

  // a,b,c,d = bottom-left, bottom-right, top-right, top-left seen from the front
  quad(a, b, c, d, nx, ny, nz, uv, col = WHITE) {
    for (const q of [a, b, c, d]) {
      this.p.push(q[0], q[1], q[2]);
      this.n.push(nx, ny, nz);
      this.c.push(col[0], col[1], col[2]);
    }
    this.u.push(...uv);
    const v = this.v;
    this.i.push(v, v + 1, v + 2, v, v + 2, v + 3);
    this.v += 4;
  }

  // Horizontal quad facing up.
  top(x0, x1, z0, z1, y, s = 1, col = WHITE, uvOverride) {
    const uv = uvOverride || [x0 * s, -z1 * s, x1 * s, -z1 * s, x1 * s, -z0 * s, x0 * s, -z0 * s];
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], 0, 1, 0, uv, col);
  }

  // Axis-aligned box without a bottom face. Side UVs wrap continuously around the box.
  box(x0, x1, y0, y1, z0, z1, o = {}) {
    const col = o.col || WHITE;
    const tw = o.tw || 1;
    const th = o.th || 1;
    const uo = o.uo || 0;
    const v0 = y0 / th + (o.vo || 0);
    const v1 = y1 / th + (o.vo || 0);
    if (o.sides !== false) {
      const dx = (x1 - x0) / tw;
      const dz = (z1 - z0) / tw;
      let u = uo;
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, [u, v0, u + dx, v0, u + dx, v1, u, v1], col);
      u += dx;
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0, [u, v0, u + dz, v0, u + dz, v1, u, v1], col);
      u += dz;
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1, [u, v0, u + dx, v0, u + dx, v1, u, v1], col);
      u += dx;
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, [u, v0, u + dz, v0, u + dz, v1, u, v1], col);
    }
    const tb = o.topBuilder || (o.top === false ? null : this);
    if (tb) tb.top(x0, x1, z0, z1, y1, o.topScale || 0.1, o.topCol || col);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
