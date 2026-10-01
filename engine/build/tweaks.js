const niceStep = (min, max) => {
  const r = Math.abs(max - min);
  return r <= 1 ? 0.01 : r <= 10 ? 0.05 : r <= 100 ? 0.5 : 1;
};

// Live tweaks: values a game exposes to the build-mode panel. Changing one calls onChange right away
// (no reload). Saved values live in games/<slug>/tweaks.json and are applied at boot.
export class Tweaks {
  constructor(saved = {}) {
    this.saved = saved || {};
    this.defs = new Map();
    this.listeners = new Set();
    this.dirty = false;
  }

  // def: { value, min?, max?, step?, type?: 'range'|'color'|'bool'|'select', options?, label?, save?, onChange? }
  // Key "Group / Name" puts the tweak under "Group" in the panel. Returns the starting value and
  // calls onChange with it immediately.
  add(key, def) {
    const type = def.type || (typeof def.value === 'boolean' ? 'bool' : typeof def.value === 'string' ? (def.options ? 'select' : 'color') : 'range');
    const value = def.save !== false && key in this.saved ? this.saved[key] : def.value;
    const d = { min: 0, max: 1, ...def, key, type, value, initial: def.value, savedValue: value };
    if (type === 'range' && d.step == null) d.step = niceStep(d.min, d.max);
    this.defs.set(key, d);
    this.apply(d);
    this.emit();
    return value;
  }

  get(key) {
    return this.defs.get(key)?.value;
  }

  set(key, value) {
    const d = this.defs.get(key);
    if (!d) return;
    d.value = value;
    this.apply(d);
    if (d.save !== false) this.dirty = true;
    this.emit();
  }

  // Tweaks changed since the last save (or since load).
  unsaved() {
    return [...this.defs.values()].filter((d) => d.save !== false && d.value !== d.savedValue);
  }

  markSaved() {
    for (const d of this.defs.values()) d.savedValue = d.value;
    this.dirty = false;
    this.emit();
  }

  discard() {
    for (const d of this.unsaved()) {
      d.value = d.savedValue;
      this.apply(d);
    }
    this.dirty = false;
    this.emit();
  }

  reset(key) {
    const d = this.defs.get(key);
    if (d) this.set(key, d.initial);
  }

  apply(d) {
    try {
      d.onChange?.(d.value);
    } catch (err) {
      console.error(`Tweak "${d.key}" failed`, err);
    }
  }

  // Values to write to tweaks.json (only saveable tweaks that differ from their default).
  values() {
    const out = {};
    for (const d of this.defs.values()) if (d.save !== false && d.value !== d.initial) out[d.key] = d.value;
    return out;
  }

  groups({ engine } = {}) {
    const g = new Map();
    for (const d of this.defs.values()) {
      if (engine !== undefined && !!d.engine !== engine) continue;
      const i = d.key.indexOf(' / ');
      const group = i > 0 ? d.key.slice(0, i) : 'General';
      if (!g.has(group)) g.set(group, []);
      g.get(group).push({ ...d, name: d.label || (i > 0 ? d.key.slice(i + 3) : d.key) });
    }
    return g;
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }
}
