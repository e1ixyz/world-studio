import * as THREE from 'three';
import { BlendFunction, BloomEffect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';

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

  // High quality renders through pmndrs postprocessing: HDR scene, MSAA, mipmap bloom, then the same
  // ACES tone mapping the renderer applies in Low (which reads renderer.toneMappingExposure too).
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: Math.min(4, renderer.capabilities.maxSamples),
  });
  composer.addPass(new RenderPass(scene, camera));
  // Added rather than screened, so HDR highlights survive until tone mapping. Five mip levels spread a
  // glow about as far as UnrealBloomPass did; the default eight wash large bright surfaces (cyberpunk
  // windows) into a gray haze. runtime.js drives intensity and threshold with the night.
  const bloom = new BloomEffect({ blendFunction: BlendFunction.ADD, mipmapBlur: true, levels: 5, radius: 0.75, intensity: 1.3, luminanceThreshold: 0.9, luminanceSmoothing: 0.03 });
  composer.addPass(new EffectPass(camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));

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
