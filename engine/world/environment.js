import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, smoothstep } from '../core/math.js';

const DAY_FOG = new THREE.Color('#aec3d8');
const DUSK_FOG = new THREE.Color('#d99a78');
const NIGHT_FOG = new THREE.Color('#0b1222');
const SUN_LOW = new THREE.Color('#ffae6b');
const SUN_HIGH = new THREE.Color('#fff3e2');
const MOON = new THREE.Color('#8fa8ff');

// Sky, sun/moon, fog and the day-night cycle.
export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = 16.6; // hours
    this.dayLength = 720; // real seconds per in-game day

    const sky = new Sky();
    sky.scale.setScalar(9000);
    const u = sky.material.uniforms;
    u.turbidity.value = 5;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    if (u.cloudCoverage) u.cloudCoverage.value = 0.35;
    scene.add(sky);
    this.sky = sky;

    this.envScene = new THREE.Scene();
    const es = new THREE.Mesh(sky.geometry, sky.material);
    es.scale.setScalar(80);
    this.envScene.add(es);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envTimer = 1e9;

    this.sunDir = new THREE.Vector3();
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    const S = 130;
    Object.assign(light.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 1400 });
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.4;
    light.shadow.radius = 3; // softer penumbra
    scene.add(light, light.target);
    this.light = light;

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3f3a33, 1);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(DAY_FOG.clone(), 0.0011);

    // stars + moon
    const n = 2500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) * 0.95 + 0.05;
      v.normalize().multiplyScalar(4000);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    scene.add(this.stars);
    this.moonMat = new THREE.MeshBasicMaterial({ color: 0xe8eeff, fog: false, transparent: true, opacity: 0, depthWrite: false });
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(90, 32), this.moonMat);
    scene.add(this.moon);

    this.night = 0;
    this.fogScale = 1; // live tweaks
    this.exposureScale = 1;
    this.elev = 0;
  }

  get clock() {
    const h = Math.floor(this.time), m = Math.floor((this.time - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  skip(hours) {
    this.time = (this.time + hours + 24) % 24;
    this.envTimer = 1e9;
  }

  // Sky look, without reaching into the Sky shader's uniforms: { turbidity, rayleigh, mie, glare }
  // (mie = mieCoefficient, glare = mieDirectionalG, 0..1). Values left out stay as they are. The
  // lighting environment map is rebuilt on the next frame so reflections match.
  /** @param {{ turbidity?: number, rayleigh?: number, mie?: number, glare?: number }} [sky] */
  setSky({ turbidity, rayleigh, mie, glare } = {}) {
    const u = this.sky.material.uniforms;
    if (turbidity != null) u.turbidity.value = turbidity;
    if (rayleigh != null) u.rayleigh.value = rayleigh;
    if (mie != null) u.mieCoefficient.value = mie;
    if (glare != null) u.mieDirectionalG.value = glare;
    this.envTimer = 1e9;
  }

  update(dt, focus, camera, timeScale = 1) {
    const hoursPerSec = 24 / this.dayLength;
    this.time = (this.time + dt * hoursPerSec * timeScale) % 24;
    const elev = Math.sin(((this.time - 6) / 12) * Math.PI) * 62;
    const az = (this.time / 24) * 360 + 200;
    this.elev = elev;
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(az));
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    if (u.time) u.time.value += dt * timeScale;

    const night = clamp((4 - elev) / 12, 0, 1);
    this.night = night;
    const sunUp = smoothstep(-3, 8, elev);
    const dusk = Math.exp(-(((elev - 3) / 8) ** 2));

    const L = this.light;
    const moonDir = this.sunDir.clone().negate();
    moonDir.y = Math.max(moonDir.y, 0.35);
    moonDir.normalize();
    let dir;
    if (sunUp > 0.02) {
      dir = this.sunDir;
      L.intensity = 2.6 * sunUp;
      L.color.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(2, 30, elev));
    } else {
      dir = moonDir;
      L.intensity = 0.55 * night;
      L.color.copy(MOON);
    }
    const f = focus;
    L.target.position.set(Math.round(f.x / 4) * 4, 0, Math.round(f.z / 4) * 4);
    L.position.copy(L.target.position).addScaledVector(dir, 600);
    L.target.updateMatrixWorld();

    // stronger sky/bounce fill keeps shadowed faces readable instead of crushed
    this.hemi.intensity = 0.7 + 0.7 * sunUp;
    this.hemi.color.set('#c4d9fb').lerp(new THREE.Color('#2a3a66'), night);
    this.hemi.groundColor.set('#6a5f52').lerp(new THREE.Color('#161a20'), night);

    const fog = this.scene.fog;
    fog.color.copy(DAY_FOG).lerp(DUSK_FOG, dusk * 0.65).lerp(NIGHT_FOG, night);
    fog.density = (0.00095 + night * 0.0006) * this.fogScale;
    this.renderer.toneMappingExposure = (0.55 + night * 0.24) * this.exposureScale;
    this.scene.environmentIntensity = 0.6 + 0.6 * sunUp;

    this.starMat.opacity = smoothstep(0.3, 1, night) * 0.9;
    this.moonMat.opacity = smoothstep(0.2, 0.9, night);
    this.stars.position.copy(camera.position);
    this.moon.position.copy(camera.position).addScaledVector(moonDir, 3800);
    this.moon.lookAt(camera.position);

    this.envTimer += dt * timeScale;
    if (this.envTimer > 5) {
      this.envTimer = 0;
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    }
    return night;
  }
}
