import * as THREE from 'three';

// Glowing collectibles with light beams you can spot from across the city.
export class Cores {
  constructor(scene, spots, T) {
    this.items = [];
    const gem = new THREE.OctahedronGeometry(0.8, 0);
    const ring = new THREE.TorusGeometry(1.25, 0.06, 6, 32);
    const beam = new THREE.CylinderGeometry(0.55, 0.55, 90, 12, 1, true).translate(0, 45, 0);
    const pool = new THREE.PlaneGeometry(7, 7).rotateX(-Math.PI / 2);
    const gemMat = new THREE.MeshStandardMaterial({ color: 0x0b3040, emissive: 0x3cf2ff, emissiveIntensity: 2.2, metalness: 0.3, roughness: 0.2 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x9ff8ff, toneMapped: false });
    const beamMat = new THREE.MeshBasicMaterial({ map: T.beam, color: 0x3cf2ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const poolMat = new THREE.MeshBasicMaterial({ map: T.pool, color: 0x3cf2ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const s of spots) {
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      const m = new THREE.Mesh(gem, gemMat);
      m.position.y = 1.6;
      m.castShadow = true;
      const r = new THREE.Mesh(ring, ringMat);
      r.position.y = 1.6;
      const b = new THREE.Mesh(beam, beamMat);
      const p = new THREE.Mesh(pool, poolMat);
      p.position.y = 0.1;
      p.renderOrder = 3;
      g.add(m, r, b, p);
      scene.add(g);
      this.items.push({ ...s, g, m, r, got: false, ph: Math.random() * 6 });
    }
    this.beamMat = beamMat;
    this.total = this.items.length;
    this.count = 0;
  }

  update(dt, time, px, py, pz, radius, onCollect) {
    for (const it of this.items) {
      if (it.got) continue;
      it.m.rotation.y += dt * 1.6;
      it.m.position.y = 1.6 + Math.sin(time * 2 + it.ph) * 0.25;
      it.r.position.y = it.m.position.y;
      it.r.rotation.x = time * 1.1 + it.ph;
      it.r.rotation.y = time * 0.7;
      if (Math.abs(py - it.y - 1) < 3.5 && Math.abs(it.x - px) < radius && Math.abs(it.z - pz) < radius && Math.hypot(it.x - px, it.z - pz) < radius) {
        it.got = true;
        it.g.visible = false;
        this.count++;
        onCollect(it);
      }
    }
  }
}
