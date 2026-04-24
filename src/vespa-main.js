import './vespa.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const canvas = document.querySelector('.model-canvas');
const loadingElement = document.querySelector('.loading');
const progressElement = document.querySelector('.loading-progress');
const introCopyElement = document.querySelector('.intro-copy');
const secondaryCopyElement = document.querySelector('.secondary-copy');
const frameIndicatorElement = document.querySelector('.frame-indicator');

const introHoldProgress = 0.1;
const introVisibleStartFrame = 0;
const introVisibleEndFrame = 31;
const secondaryVisibleStartFrame = 40;
const secondaryVisibleEndFrame = 45;
const modelPath = '/models/vespa.glb';
const baseTimelineFrames = 100;
const secondaryHoldFrameCount = secondaryVisibleEndFrame - secondaryVisibleStartFrame;
const totalTimelineFrames = baseTimelineFrames + secondaryHoldFrameCount;
const globalMaterialControls = {
  envMapIntensity: 1,
};
const cameraControls = {
  fovOffset: 0,
  frameOffset: 0
};
const namedMaterialControls = {
  Main: {
    envMapIntensity: 1,
    metalness: null,
    roughness: 1
  }
};

const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
  pixelRatio: Math.min(window.devicePixelRatio, 2)
};

const state = {
  targetScroll: 0,
  currentScroll: 0,
  targetTimelineFrame: 0,
  currentTimelineFrame: 0,
  isReady: false
};

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance'
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xffffff, 0);
renderer.setPixelRatio(sizes.pixelRatio);
renderer.setSize(sizes.width, sizes.height);

const scene = new THREE.Scene();
scene.background = null;

const ambientLight = new THREE.HemisphereLight(0xffffff, 0xd7dbe0, 0);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 0);
keyLight.position.set(6, 8, 10);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0);
fillLight.position.set(-5, 3, 6);
scene.add(fillLight);

const activeCamera = new THREE.PerspectiveCamera(35, sizes.width / sizes.height, 0.1, 1000);
activeCamera.position.set(0, 0, 8);
scene.add(activeCamera);

let animationClip = null;
let animationMixer = null;
let animatedCamera = null;
let fallbackSceneRoot = null;
let clipDuration = 0;
let lastTickTime = performance.now();
let environmentMap = null;
let cameraLabel = 'Camara no detectada';
let clipLabel = 'Sin animacion';

function getScrollProgress() {
  const maxScroll = Math.max(document.body.scrollHeight - window.innerHeight, 1);
  return window.scrollY / maxScroll;
}

function onScroll() {
  state.targetScroll = getScrollProgress();
}

function damp(current, target, smoothing, deltaSeconds) {
  return current + (target - current) * (1 - Math.exp(-smoothing * deltaSeconds));
}

function getIntroOpacity(frameIndex) {
  if (frameIndex < introVisibleStartFrame || frameIndex > introVisibleEndFrame) {
    return 0;
  }

  const fadeInEndFrame = 10;
  const fadeOutStartFrame = 24;

  if (frameIndex <= fadeInEndFrame) {
    return Math.min(
      Math.max((frameIndex - introVisibleStartFrame) / (fadeInEndFrame - introVisibleStartFrame), 0),
      1
    );
  }

  if (frameIndex >= fadeOutStartFrame) {
    return Math.min(
      Math.max((introVisibleEndFrame - frameIndex) / (introVisibleEndFrame - fadeOutStartFrame), 0),
      1
    );
  }

  return 1;
}

function getSecondaryOpacity(frameIndex) {
  if (frameIndex < secondaryVisibleStartFrame || frameIndex > secondaryVisibleEndFrame) {
    return 0;
  }

  const fadeInEndFrame = 42;
  const fadeOutStartFrame = 44;

  if (frameIndex <= fadeInEndFrame) {
    return Math.min(
      Math.max(
        (frameIndex - secondaryVisibleStartFrame) / (fadeInEndFrame - secondaryVisibleStartFrame),
        0
      ),
      1
    );
  }

  if (frameIndex >= fadeOutStartFrame) {
    return Math.min(
      Math.max(
        (secondaryVisibleEndFrame - frameIndex) / (secondaryVisibleEndFrame - fadeOutStartFrame),
        0
      ),
      1
    );
  }

  return 1;
}

function getNarrativeFrame(timelineFrame) {
  if (timelineFrame <= secondaryVisibleEndFrame) {
    return timelineFrame;
  }

  return timelineFrame - secondaryHoldFrameCount;
}

function getDisplayFrame(timelineFrame) {
  if (timelineFrame >= secondaryVisibleStartFrame && timelineFrame <= secondaryVisibleEndFrame) {
    return secondaryVisibleStartFrame;
  }

  if (timelineFrame > secondaryVisibleEndFrame) {
    return timelineFrame - secondaryHoldFrameCount;
  }

  return timelineFrame;
}

function getCameraFrame(displayFrame) {
  return Math.min(Math.max(displayFrame + cameraControls.frameOffset, 0), baseTimelineFrames - 1);
}

function updateFrameIndicator(displayFrame, cameraFrame) {
  const frameLabel = `anim${String(displayFrame + 1).padStart(4, '0')}`;
  const cameraFrameLabel = `cam${String(cameraFrame + 1).padStart(4, '0')}`;
  frameIndicatorElement.textContent = `${frameLabel} | ${cameraFrameLabel} | ${cameraLabel} | ${clipLabel}`;
}

function setOverlayState(narrativeFrame) {
  const introOpacity = getIntroOpacity(narrativeFrame);
  const secondaryOpacity = getSecondaryOpacity(narrativeFrame);

  introCopyElement.style.opacity = String(introOpacity);
  introCopyElement.style.transform = `translate3d(0, ${-36 * (1 - introOpacity)}px, 0)`;

  secondaryCopyElement.style.opacity = String(secondaryOpacity);
  secondaryCopyElement.style.transform = `translate3d(0, ${-36 * (1 - secondaryOpacity)}px, 0)`;
}

function syncActiveCamera() {
  if (!animatedCamera || !animatedCamera.isPerspectiveCamera) {
    return;
  }

  activeCamera.position.copy(animatedCamera.position);
  activeCamera.quaternion.copy(animatedCamera.quaternion);
  activeCamera.scale.copy(animatedCamera.scale);
  activeCamera.fov = animatedCamera.fov + cameraControls.fovOffset;
  activeCamera.near = animatedCamera.near;
  activeCamera.far = animatedCamera.far;
  activeCamera.zoom = animatedCamera.zoom;
  activeCamera.updateProjectionMatrix();
}

function fitFallbackCamera() {
  if (!fallbackSceneRoot) {
    return;
  }

  const box = new THREE.Box3().setFromObject(fallbackSceneRoot);

  if (box.isEmpty()) {
    return;
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxSize = Math.max(size.x, size.y, size.z);
  activeCamera.position.set(center.x, center.y + size.y * 0.1, center.z + maxSize * 1.8);
  activeCamera.lookAt(center);
  activeCamera.updateProjectionMatrix();
}

function resizeRenderer() {
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;
  sizes.pixelRatio = Math.min(window.devicePixelRatio, 2);

  renderer.setPixelRatio(sizes.pixelRatio);
  renderer.setSize(sizes.width, sizes.height);

  activeCamera.aspect = sizes.width / sizes.height;
  activeCamera.updateProjectionMatrix();

  if (animatedCamera && animatedCamera.isPerspectiveCamera) {
    animatedCamera.aspect = sizes.width / sizes.height;
    animatedCamera.updateProjectionMatrix();
  }
}

function applyMaterialControls(root) {
  if (!root) {
    return;
  }

  root.traverse((child) => {
    if (!child.isMesh) {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];

    materials.forEach((material) => {
      if (!material || !('envMapIntensity' in material)) {
        return;
      }

      material.envMapIntensity = globalMaterialControls.envMapIntensity;

      const namedControls = material.name ? namedMaterialControls[material.name] : null;

      if ('envMapIntensity' in material && namedControls?.envMapIntensity !== undefined) {
        material.envMapIntensity = namedControls.envMapIntensity;
      }

      if ('metalness' in material && namedControls?.metalness !== undefined) {
        material.metalness = namedControls.metalness;
      }

      if ('roughness' in material && namedControls?.roughness !== undefined) {
        material.roughness = namedControls.roughness;
      }

      material.needsUpdate = true;
    });
  });
}

function loadEnvironment() {
  const rgbeLoader = new RGBELoader();
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  rgbeLoader.load(
    '/hdr/brown_photostudio_02_1k.hdr',
    (texture) => {
      const environmentRenderTarget = pmremGenerator.fromEquirectangular(texture);
      environmentMap = environmentRenderTarget.texture;

      scene.environment = environmentMap;
      scene.environmentIntensity = globalMaterialControls.envMapIntensity;

      if (fallbackSceneRoot) {
        applyMaterialControls(fallbackSceneRoot);
      }

      texture.dispose();
      pmremGenerator.dispose();
    },
    undefined,
    () => {
      pmremGenerator.dispose();
      clipLabel = `${clipLabel} | HDR no cargado`;
    }
  );
}

function loadScene() {
  const loader = new GLTFLoader();

  loader.load(
    modelPath,
    (gltf) => {
      fallbackSceneRoot = gltf.scene;
      scene.add(gltf.scene);

      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = false;
        }

        if (!animatedCamera && child.isCamera) {
          animatedCamera = child;
        }
      });

      applyMaterialControls(gltf.scene);

      if (!animatedCamera && gltf.cameras && gltf.cameras.length > 0) {
        animatedCamera = gltf.cameras[0];
      }

      if (animatedCamera && animatedCamera.isPerspectiveCamera) {
        animatedCamera.aspect = sizes.width / sizes.height;
        animatedCamera.updateProjectionMatrix();
        cameraLabel = `Camara: ${animatedCamera.name || 'PerspectiveCamera'}`;
      } else {
        fitFallbackCamera();
        cameraLabel = 'Camara fallback activa';
      }

      if (gltf.animations.length > 0) {
        animationClip = gltf.animations[0];
        clipDuration = animationClip.duration;
        animationMixer = new THREE.AnimationMixer(gltf.scene);
        const action = animationMixer.clipAction(animationClip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        animationMixer.setTime(0);
        clipLabel = `Clip: ${animationClip.name || 'Animacion 01'}`;
      } else {
        clipLabel = 'Sin animacion';
      }

      progressElement.textContent = '100%';
      loadingElement.classList.add('is-hidden');
      state.isReady = true;
      syncActiveCamera();
      updateFrameIndicator(0, getCameraFrame(0));
      renderer.render(scene, activeCamera);
    },
    (event) => {
      if (!event.total) {
        progressElement.textContent = 'Cargando...';
        return;
      }

      const progress = Math.min(Math.round((event.loaded / event.total) * 100), 100);
      progressElement.textContent = `${progress}%`;
    },
    () => {
      progressElement.textContent = 'Error al cargar';
      frameIndicatorElement.textContent = `No se pudo cargar ${modelPath.split('/').pop()}`;
    }
  );
}

function tick() {
  const now = performance.now();
  const deltaSeconds = Math.min((now - lastTickTime) / 1000, 0.1);
  lastTickTime = now;

  state.currentScroll = damp(state.currentScroll, state.targetScroll, 9, deltaSeconds);

  let targetTimelineFrame = 0;

  if (state.currentScroll > introHoldProgress) {
    const sequenceProgress = (state.currentScroll - introHoldProgress) / (1 - introHoldProgress);
    targetTimelineFrame = Math.min(Math.max(sequenceProgress, 0), 1) * (totalTimelineFrames - 1);
  }

  state.targetTimelineFrame = targetTimelineFrame;
  state.currentTimelineFrame = damp(state.currentTimelineFrame, state.targetTimelineFrame, 14, deltaSeconds);

  const timelineFrame = Math.round(state.currentTimelineFrame);
  const narrativeFrame = getNarrativeFrame(timelineFrame);
  const displayFrame = getDisplayFrame(timelineFrame);
  const cameraFrame = getCameraFrame(displayFrame);

  setOverlayState(narrativeFrame);

  if (state.isReady && animationMixer && clipDuration > 0) {
    const clipProgress = cameraFrame / (baseTimelineFrames - 1);
    const safeTime = Math.min(clipProgress * clipDuration, Math.max(clipDuration - 0.0001, 0));
    animationMixer.setTime(safeTime);
    syncActiveCamera();
  }

  if (state.isReady) {
    updateFrameIndicator(displayFrame, cameraFrame);
  }

  renderer.render(scene, activeCamera);
  window.requestAnimationFrame(tick);
}

window.addEventListener('scroll', onScroll);
window.addEventListener('resize', resizeRenderer);

resizeRenderer();
onScroll();
loadEnvironment();
loadScene();
tick();
