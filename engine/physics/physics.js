// Rigid-body physics for games, on Rapier (WebAssembly). Loaded only when a game calls
// `await ctx.physics()`, so games that don't use it never download it. The engine steps the world
// on a fixed 1/60 s clock while the world is simulating (so it pauses with the game), keeps each
// body's mesh in step with it, lets the player shove bodies around, and makes bodies clickable in
// build mode. See engine/API.md, "Physics".
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

const STEP = 1 / 60;
const MAX_STEPS = 4;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _box = new THREE.Box3();

let ready = null;
// Rapier's WASM, once per page.
export function loadRapier() {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}

// Box arrays like ctx.select uses: [x0, y0, z0, x1, y1, z1].
const isBoxArray = (b) => Array.isArray(b) && b.length === 6;

export async function createPhysics({ gravity = -9.81, scene, select, tweaks } = {}) {
  await loadRapier();
  const world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
  world.timestep = STEP;
  const events = new RAPIER.EventQueue(true);
  const tracked = new Map(); // body handle -> { body, mesh, index, kind, id }
  const contacts = new Map(); // collider handle -> fn(otherBody, started)
  let acc = 0;
  let player = null; // the kinematic capsule (or car box) that follows the player
  let debugLines = null;

  // ---------- shapes ----------
  function colliderFor(mesh, shape, index) {
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    // world-space scale of the mesh (or of one instance)
    if (index != null) {
      mesh.getMatrixAt(index, _m);
      _m.decompose(_v, _q, _s);
      _s.multiply(mesh.getWorldScale(new THREE.Vector3()));
    } else mesh.getWorldScale(_s);
    const size = bb.getSize(new THREE.Vector3()).multiply(_s);
    switch (shape) {
      case 'ball':
        return RAPIER.ColliderDesc.ball(Math.max(size.x, size.y, size.z) / 2);
      case 'capsule':
        return RAPIER.ColliderDesc.capsule(Math.max(0, size.y / 2 - size.x / 2), size.x / 2);
      case 'hull':
      case 'trimesh': {
        const pos = geo.attributes.position;
        const verts = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          verts[i * 3] = pos.getX(i) * _s.x;
          verts[i * 3 + 1] = pos.getY(i) * _s.y;
          verts[i * 3 + 2] = pos.getZ(i) * _s.z;
        }
        if (shape === 'hull') return RAPIER.ColliderDesc.convexHull(verts) ?? RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
        const idx = geo.index ? new Uint32Array(geo.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
        return RAPIER.ColliderDesc.trimesh(verts, idx);
      }
      default: {
        // box around the geometry, offset if the geometry isn't centered on its origin
        const c = bb.getCenter(new THREE.Vector3()).multiply(_s);
        return RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(c.x, c.y, c.z);
      }
    }
  }

  function applyMaterial(desc, o) {
    if (o.friction != null) desc.setFriction(o.friction);
    if (o.restitution != null) desc.setRestitution(o.restitution);
    if (o.density != null) desc.setDensity(o.density);
    if (o.mass != null) desc.setMass(o.mass);
    if (o.sensor) desc.setSensor(true);
    desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    return desc;
  }

  // world-space transform of a mesh, or of one instance of an InstancedMesh
  function worldPose(mesh, index) {
    mesh.updateWorldMatrix(true, false);
    if (index != null) {
      mesh.getMatrixAt(index, _m);
      _m.premultiply(mesh.matrixWorld);
    } else _m.copy(mesh.matrixWorld);
    _m.decompose(_v, _q, _s);
    return { p: { x: _v.x, y: _v.y, z: _v.z }, q: { x: _q.x, y: _q.y, z: _q.z, w: _q.w } };
  }

  // ---------- public API ----------

  // A fixed collider: a Mesh (shape 'trimesh' by default, or 'box' | 'hull'), or a box
  // [x0, y0, z0, x1, y1, z1].
  function addStatic(target, o = {}) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    if (isBoxArray(target)) {
      const [x0, y0, z0, x1, y1, z1] = target;
      body.setTranslation({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 }, false);
      return world.createCollider(applyMaterial(RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2), o), body);
    }
    const { p, q } = worldPose(target, o.index);
    body.setTranslation(p, false);
    body.setRotation(q, false);
    return world.createCollider(applyMaterial(colliderFor(target, o.shape || 'trimesh', o.index), o), body);
  }

  // Terrain: heights is (rows + 1) * (cols + 1) values, row-major; size is the full extent in meters.
  function addHeightfield(rows, cols, heights, { size = { x: 100, y: 1, z: 100 }, center = { x: 0, y: 0, z: 0 }, ...o } = {}) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z));
    return world.createCollider(applyMaterial(RAPIER.ColliderDesc.heightfield(rows, cols, Float32Array.from(heights), size), o), body);
  }

  // A moving body for a mesh (or one instance: { index }). shape 'box' (default) | 'ball' |
  // 'capsule' | 'hull'. kinematic: true for bodies the game moves itself. The mesh follows the
  // body after every step; keep body meshes as direct children of the scene.
  function addBody(mesh, o = {}) {
    const { p, q } = worldPose(mesh, o.index);
    const desc = (o.kinematic ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic()).setTranslation(p.x, p.y, p.z).setRotation(q);
    if (o.ccd) desc.setCcdEnabled(true);
    if (o.linearDamping != null) desc.setLinearDamping(o.linearDamping);
    if (o.angularDamping != null) desc.setAngularDamping(o.angularDamping);
    const body = world.createRigidBody(desc);
    world.createCollider(applyMaterial(colliderFor(mesh, o.shape || 'box', o.index), o), body);
    if (o.velocity) body.setLinvel(o.velocity, true);
    if (o.angularVelocity) body.setAngvel(o.angularVelocity, true);
    tracked.set(body.handle, { body, mesh, index: o.index, kind: o.kind || 'body', id: o.id ?? null, source: o.source || null, select: o.select !== false });
    return body;
  }

  // fn(otherBody | null, started) when a body's colliders start or stop touching anything.
  function onContact(body, fn) {
    for (let i = 0; i < body.numColliders(); i++) contacts.set(body.collider(i).handle, fn);
  }

  // The first collider hit along a ray: { point, distance, body, mesh } or null.
  function raycast(origin, dir, maxDist = 500, { exclude } = {}) {
    const d = _v.set(dir.x, dir.y, dir.z).normalize();
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: d.x, y: d.y, z: d.z });
    const hit = world.castRay(ray, maxDist, true, undefined, undefined, undefined, exclude ?? player?.body);
    if (!hit) return null;
    const point = ray.pointAt(hit.timeOfImpact);
    const body = hit.collider.parent();
    return { point: new THREE.Vector3(point.x, point.y, point.z), distance: hit.timeOfImpact, body, mesh: body ? tracked.get(body.handle)?.mesh ?? null : null };
  }

  // Height of the first surface below (x, top, z), for a game's world.groundY so the player walks
  // on static colliders (and on top of bodies).
  function groundY(x, z, fallback = 0, top = 400) {
    const hit = raycast({ x, y: top, z }, { x: 0, y: -1, z: 0 }, top + 1000);
    return hit ? hit.point.y : fallback;
  }

  function remove(body) {
    tracked.delete(body.handle);
    for (let i = 0; i < body.numColliders(); i++) contacts.delete(body.collider(i).handle);
    world.removeRigidBody(body);
  }

  // The engine moves this every frame so the player (or the car being driven) shoves bodies.
  function movePlayer(pos, car) {
    const want = car ? 'car' : 'foot';
    if (player?.mode !== want) {
      if (player) world.removeRigidBody(player.body);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      world.createCollider(car ? RAPIER.ColliderDesc.cuboid(car.hx ?? 2.2, 0.8, car.hz ?? 1) : RAPIER.ColliderDesc.capsule(0.5, 0.4), body);
      player = { body, mode: want };
    }
    if (car) {
      player.body.setNextKinematicTranslation({ x: car.x, y: (car.y ?? 0) + 0.8, z: car.z });
      _q.setFromAxisAngle(_v.set(0, 1, 0), car.heading ?? 0);
      player.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    } else player.body.setNextKinematicTranslation({ x: pos.x, y: pos.y + 0.9, z: pos.z });
  }

  function sync() {
    for (const t of tracked.values()) {
      if (t.body.isSleeping() || t.body.isFixed()) continue;
      const p = t.body.translation();
      const r = t.body.rotation();
      if (t.index != null) {
        // keep the instance's scale; instance matrices are in the InstancedMesh's space, which
        // must be the world's (an InstancedMesh with physics instances stays at the origin)
        t.mesh.getMatrixAt(t.index, _m);
        _m.decompose(_v, _q, _s);
        _m.compose(_v.set(p.x, p.y, p.z), _q.set(r.x, r.y, r.z, r.w), _s);
        t.mesh.setMatrixAt(t.index, _m);
        t.mesh.instanceMatrix.needsUpdate = true;
      } else {
        t.mesh.position.set(p.x, p.y, p.z);
        t.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
  }

  // Advance on a fixed clock: whole 1/60 s steps, at most MAX_STEPS a frame (a slow frame drops
  // time rather than spiralling).
  function step(dt) {
    acc = Math.min(acc + dt, STEP * MAX_STEPS);
    let n = 0;
    while (acc >= STEP) {
      world.step(events);
      acc -= STEP;
      n++;
      events.drainCollisionEvents((h1, h2, started) => {
        for (const [mine, theirs] of [
          [h1, h2],
          [h2, h1],
        ]) {
          const fn = contacts.get(mine);
          if (fn) fn(world.getCollider(theirs)?.parent() ?? null, started);
        }
      });
    }
    if (n) sync();
    if (debugLines?.visible) drawDebug();
    return n;
  }

  // ---------- build mode: clickable bodies and the collider overlay ----------
  select?.addProvider(() => {
    const out = [];
    for (const t of tracked.values()) {
      if (!t.select) continue;
      const v = t.body.linvel();
      out.push({
        kind: t.kind,
        id: t.id ?? t.body.handle,
        props: { mass: Number(t.body.mass().toFixed(2)), speed: Number(Math.hypot(v.x, v.y, v.z).toFixed(2)), sleeping: t.body.isSleeping() },
        source: t.source,
        getBox: () => {
          if (t.index == null) return _box.setFromObject(t.mesh);
          t.mesh.geometry.computeBoundingBox();
          t.mesh.getMatrixAt(t.index, _m);
          return _box.copy(t.mesh.geometry.boundingBox).applyMatrix4(_m.premultiply(t.mesh.matrixWorld));
        },
      });
    }
    return out;
  });

  function drawDebug() {
    const { vertices, colors } = world.debugRender();
    const g = debugLines.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    g.computeBoundingSphere();
  }
  function showColliders(on) {
    if (on && !debugLines) {
      debugLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
      debugLines.renderOrder = 997;
      debugLines.frustumCulled = false;
      scene?.add(debugLines);
    }
    if (debugLines) debugLines.visible = on;
    if (on) drawDebug();
  }
  tweaks?.add('Physics / Show colliders', { value: false, engine: true, save: false, onChange: showColliders });

  return {
    RAPIER,
    world,
    addStatic,
    addHeightfield,
    addBody,
    onContact,
    raycast,
    groundY,
    remove,
    step,
    movePlayer,
    showColliders,
    get bodies() {
      return [...tracked.values()].map((t) => t.body);
    },
    meshOf: (body) => tracked.get(body.handle)?.mesh ?? null,
    dispose() {
      debugLines?.removeFromParent();
      world.free();
    },
  };
}
