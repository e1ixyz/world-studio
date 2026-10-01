import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Renderer, scene, camera, bloom and the High/Low quality switch.
export function createApp(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.2, 12000);
  camera.rotation.order = 'YXZ';

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.5, 0.5, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const app = {
    renderer, scene, camera, composer, bloom,
    canvas: renderer.domElement,
    high: true,
    shadowLight: null,
    captures: [],
    applyQuality() {
      const pr = Math.min(window.devicePixelRatio, app.high ? 1.5 : 1);
      renderer.setPixelRatio(pr);
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setPixelRatio(pr);
      composer.setSize(window.innerWidth, window.innerHeight);
      if (app.shadowLight) app.shadowLight.castShadow = app.high;
    },
    render() {
      if (app.high) composer.render();
      else renderer.render(scene, camera);
      // read the canvas in the same task as the render, so no preserveDrawingBuffer is needed
      if (app.captures.length) {
        const jobs = app.captures.splice(0);
        for (const { resolve, width, quality } of jobs) resolve(snapshotCanvas(renderer.domElement, width, quality));
      }
    },
    // Resolves with a JPEG data URL of the next rendered frame.
    capture({ width = 0, quality = 0.85 } = {}) {
      return new Promise((resolve) => app.captures.push({ resolve, width, quality }));
    },
  };
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    app.applyQuality();
  });
  return app;
}

function snapshotCanvas(src, width, quality) {
  if (!width || width >= src.width) return src.toDataURL('image/jpeg', quality);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round((src.height / src.width) * width);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
