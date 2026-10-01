// Uniform grid of axis-aligned rectangles (building footprints, tree trunks...).
export class CollisionGrid {
  constructor(cell = 32) {
    this.cell = cell;
    this.cells = new Map();
    this.stamp = 0;
  }

  key(cx, cz) {
    return (cx + 2000) * 8192 + (cz + 2000);
  }

  add(r) {
    r._s = 0;
    const c = this.cell;
    for (let cx = Math.floor(r.x0 / c); cx <= Math.floor(r.x1 / c); cx++) {
      for (let cz = Math.floor(r.z0 / c); cz <= Math.floor(r.z1 / c); cz++) {
        const k = this.key(cx, cz);
        let a = this.cells.get(k);
        if (!a) this.cells.set(k, (a = []));
        a.push(r);
      }
    }
  }

  query(x, z, rad, out = []) {
    out.length = 0;
    const s = ++this.stamp;
    const c = this.cell;
    for (let cx = Math.floor((x - rad) / c); cx <= Math.floor((x + rad) / c); cx++) {
      for (let cz = Math.floor((z - rad) / c); cz <= Math.floor((z + rad) / c); cz++) {
        const a = this.cells.get(this.key(cx, cz));
        if (!a) continue;
        for (const r of a) {
          if (r._s !== s) {
            r._s = s;
            out.push(r);
          }
        }
      }
    }
    return out;
  }

  pointInside(x, z, margin = 0) {
    const rs = this.query(x, z, 0, this._tmp || (this._tmp = []));
    for (const r of rs) {
      if (x > r.x0 - margin && x < r.x1 + margin && z > r.z0 - margin && z < r.z1 + margin) return true;
    }
    return false;
  }
}

// Push a circle (p.x, p.z, radius r) out of every rect. Returns true if it hit anything.
export function resolveCircle(p, r, rects) {
  let hit = false;
  for (const b of rects) {
    const cx = p.x < b.x0 ? b.x0 : p.x > b.x1 ? b.x1 : p.x;
    const cz = p.z < b.z0 ? b.z0 : p.z > b.z1 ? b.z1 : p.z;
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      const k = (r - d) / d;
      p.x += dx * k;
      p.z += dz * k;
    } else {
      // center is inside the rect: exit through the nearest side
      const l = p.x - b.x0, rt = b.x1 - p.x, t = p.z - b.z0, bt = b.z1 - p.z;
      const m = Math.min(l, rt, t, bt);
      if (m === l) p.x = b.x0 - r;
      else if (m === rt) p.x = b.x1 + r;
      else if (m === t) p.z = b.z0 - r;
      else p.z = b.z1 + r;
    }
  }
  return hit;
}
