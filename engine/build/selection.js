import * as THREE from 'three';

const toBox = (b) => {
  if (b instanceof THREE.Box3) return b.clone();
  const [x0, y0, z0, x1, y1, z1] = b;
  return new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
};
const fmt = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v);

// Point-and-prompt: games register what can be clicked in build mode. Picking is a ray against
// each entry's bounding box, so it also works for merged or instanced geometry.
export class Selection {
  constructor(scene) {
    this.items = [];
    this.providers = [];
    this.selected = null;
    this.listeners = new Set();
    this.helper = new THREE.Box3Helper(new THREE.Box3(), 0xffd24a);
    this.helper.material.depthTest = false;
    this.helper.material.transparent = true;
    this.helper.renderOrder = 999;
    this.helper.visible = false;
    scene.add(this.helper);
  }

  // entry: { kind, id?, box: [x0, y0, z0, x1, y1, z1] | Box3, props?, source? }
  add(entry) {
    const e = { ...entry, box: toBox(entry.box) };
    this.items.push(e);
    return e;
  }

  // For things that move (cars, people). fn() returns entries; give an entry getBox() to keep the outline on it.
  addProvider(fn) {
    this.providers.push(fn);
  }

  clear() {
    this.items.length = 0;
    this.providers.length = 0;
    this.select(null);
  }

  pick(raycaster) {
    const ray = raycaster.ray;
    const hit = new THREE.Vector3();
    let best = null, bestD = Infinity;
    const test = (e) => {
      const box = e.getBox ? toBox(e.getBox()) : e.box;
      if (box.containsPoint(ray.origin)) return;
      if (ray.intersectBox(box, hit)) {
        const d = hit.distanceTo(ray.origin);
        if (d < bestD) {
          bestD = d;
          best = { ...e, box };
        }
      }
    };
    for (const e of this.items) test(e);
    for (const p of this.providers) for (const e of p()) test(e);
    return best;
  }

  select(entry) {
    this.selected = entry;
    this.helper.visible = !!entry;
    if (entry) this.helper.box.copy(entry.box);
    for (const fn of this.listeners) fn(entry);
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  update() {
    const e = this.selected;
    if (e?.getBox) {
      e.box = toBox(e.getBox());
      this.helper.box.copy(e.box);
    }
  }

  // Text block added to prompts so Claude knows exactly what the user clicked.
  describe(e = this.selected) {
    if (!e) return '';
    const c = e.box.getCenter(new THREE.Vector3());
    const s = e.box.getSize(new THREE.Vector3());
    const props = Object.entries(e.props || {}).map(([k, v]) => `${k}=${fmt(v)}`).join(', ');
    return `[Selected object: ${e.kind}${e.id != null ? ` "${e.id}"` : ''} centered at x=${c.x.toFixed(1)}, y=${c.y.toFixed(1)}, z=${c.z.toFixed(1)}, size ${s.x.toFixed(1)} x ${s.y.toFixed(1)} x ${s.z.toFixed(1)} m${props ? `. Properties: ${props}` : ''}${e.source ? `. Defined in: ${e.source}` : ''}]`;
  }
}
