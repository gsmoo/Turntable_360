import './turntable.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const modelCanvas = document.querySelector('.model-canvas');
const bloomCanvas = document.querySelector('.bloom-canvas');
const canvas = document.querySelector('.turntable-canvas');
const context = canvas.getContext('2d', { alpha: true });
const loadingElement = document.querySelector('.loading');
const progressElement = document.querySelector('.loading-progress');
const frameIndicatorElement = document.querySelector('.frame-indicator');
const compareModeElement = document.querySelector('.compare-mode');
const colorMenuElement = document.querySelector('.color-menu');
const colorButtons = Array.from(document.querySelectorAll('.color-button'));

const totalFrames = 181;
const totalColorVariants = 2;
const frameCacheRadius = 10;
const dragSensitivity = 0.18;
const inertiaDamping = 0.5;
const minimumVelocity = 0.012;
const modelPath = '/models/vespa_turn.glb';
const compareModes = ['overlay', 'sequence', 'model'];
const hoverFillOpacity = 0.15;
const hoverColor = new THREE.Color('#ff7900');
const hoverEmissiveIntensity = 0.75;
const hoverBloomOpacity = 0.675;
const hoverPulseSpeed = 0.0055;
const hoverPulseAmount = 0.18;
const hoverNoiseAmount = 0.08;
const sequenceVariants = {
  yellow: 'Anim_Body_Yellow',
  red: 'Anim_Body_Red'
};

const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
  pixelRatio: Math.min(window.devicePixelRatio, 2)
};

const state = {
  loadedFrames: 0,
  renderedFrame: -1,
  currentFrame: 0,
  isDragging: false,
  activePointerId: null,
  dragStartX: 0,
  dragStartFrame: 0,
  velocity: 0,
  lastPointerX: 0,
  lastPointerTime: 0,
  lastDragDeltaFrame: 0,
  lastDragDeltaTime: 16.6667,
  pointerDownDistance: 0,
  compareModeIndex: 0,
  modelReady: false,
  isHoveringModel: false,
  currentColor: 'yellow',
  isColorMenuVisible: false,
  cacheCenterFrame: -1,
  initialCacheReady: false
};

const renderer = new THREE.WebGLRenderer({
  canvas: modelCanvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance'
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xffffff, 0);
renderer.setPixelRatio(sizes.pixelRatio);
renderer.setSize(sizes.width, sizes.height);

const bloomRenderer = new THREE.WebGLRenderer({
  canvas: bloomCanvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance'
});
bloomRenderer.outputColorSpace = THREE.SRGBColorSpace;
bloomRenderer.setClearColor(0xffffff, 0);
bloomRenderer.setPixelRatio(sizes.pixelRatio);
bloomRenderer.setSize(sizes.width, sizes.height);

const scene = new THREE.Scene();
scene.background = null;
const bloomScene = new THREE.Scene();
bloomScene.background = null;

const activeCamera = new THREE.PerspectiveCamera(35, sizes.width / sizes.height, 0.1, 1000);
activeCamera.position.set(0, 0, 8);
scene.add(activeCamera);

const ambientLight = new THREE.HemisphereLight(0xffffff, 0xd7dbe0, 0.35);
scene.add(ambientLight);

let fallbackSceneRoot = null;
let animatedCamera = null;
let animationMixer = null;
let animationClip = null;
let clipDuration = 0;
let currentModelFrame = 0;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(2, 2);
let hoverFillGroup = null;
let hoverBloomGroup = null;
const hoverAnimatedMaterials = {
  fill: [],
  bloom: []
};

const imagesByColor = Object.fromEntries(
  Object.entries(sequenceVariants).map(([colorKey, prefix]) => {
    const frames = Array.from({ length: totalFrames }, (_, index) => {
      const frameNumber = String(index).padStart(4, '0');
      return {
        colorKey,
        index,
        filename: `${prefix}${frameNumber}.webp`,
        src: `/sequences/${prefix}${frameNumber}.webp`,
        image: null,
        status: 'idle'
      };
    });

    return [colorKey, frames];
  })
);

const cacheTargetFrames = (frameCacheRadius * 2 + 1) * totalColorVariants;

function wrapFrame(frame) {
  return ((frame % totalFrames) + totalFrames) % totalFrames;
}

function updateLoadingProgress(message) {
  if (message) {
    progressElement.textContent = message;
    return;
  }

  progressElement.textContent = `${state.loadedFrames} / ${cacheTargetFrames}`;
}

function getWindowFrameIndices(centerFrame) {
  const safeCenter = wrapFrame(centerFrame);
  const frameIndices = [];

  for (let offset = -frameCacheRadius; offset <= frameCacheRadius; offset += 1) {
    frameIndices.push(wrapFrame(safeCenter + offset));
  }

  return frameIndices;
}

function isInitialWindowReady() {
  const initialIndices = getWindowFrameIndices(0);

  return Object.keys(sequenceVariants).every((colorKey) =>
    initialIndices.every((frameIndex) => imagesByColor[colorKey][frameIndex].status === 'loaded')
  );
}

function ensureFrameLoaded(colorKey, frameIndex) {
  const safeIndex = wrapFrame(frameIndex);
  const frameRecord = imagesByColor[colorKey][safeIndex];

  if (!frameRecord || frameRecord.status === 'loaded' || frameRecord.status === 'loading') {
    return;
  }

  const image = new Image();
  image.decoding = 'async';
  image.loading = 'eager';

  frameRecord.image = image;
  frameRecord.status = 'loading';

  image.onload = () => {
    frameRecord.status = 'loaded';
    state.loadedFrames += 1;
    updateLoadingProgress();

    const currentFrame = wrapFrame(Math.round(state.currentFrame));

    if (colorKey === state.currentColor && safeIndex === currentFrame) {
      drawFrame(currentFrame);
    }

    if (!state.initialCacheReady && isInitialWindowReady()) {
      state.initialCacheReady = true;
      loadingElement.classList.add('is-hidden');
    }
  };

  image.onerror = () => {
    frameRecord.status = 'error';
    frameRecord.image = null;
    updateLoadingProgress(`Error en ${frameRecord.filename}`);
  };

  image.src = frameRecord.src;
}

function releaseFrame(colorKey, frameIndex) {
  const safeIndex = wrapFrame(frameIndex);
  const frameRecord = imagesByColor[colorKey][safeIndex];

  if (!frameRecord || frameRecord.status === 'idle' || frameRecord.status === 'error') {
    return;
  }

  const wasLoaded = frameRecord.status === 'loaded';

  if (frameRecord.image) {
    frameRecord.image.onload = null;
    frameRecord.image.onerror = null;
    frameRecord.image.src = '';
  }

  frameRecord.image = null;
  frameRecord.status = 'idle';

  if (wasLoaded) {
    state.loadedFrames = Math.max(0, state.loadedFrames - 1);
    updateLoadingProgress();
  }
}

function syncFrameCache(centerFrame) {
  const keepIndices = new Set(getWindowFrameIndices(centerFrame));

  Object.keys(sequenceVariants).forEach((colorKey) => {
    keepIndices.forEach((frameIndex) => {
      ensureFrameLoaded(colorKey, frameIndex);
    });

    imagesByColor[colorKey].forEach((frameRecord, frameIndex) => {
      if (!keepIndices.has(frameIndex)) {
        releaseFrame(colorKey, frameIndex);
      }
    });
  });
}

function resizeCanvas() {
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;
  sizes.pixelRatio = Math.min(window.devicePixelRatio, 2);

  renderer.setPixelRatio(sizes.pixelRatio);
  renderer.setSize(sizes.width, sizes.height);
  bloomRenderer.setPixelRatio(sizes.pixelRatio);
  bloomRenderer.setSize(sizes.width, sizes.height);

  activeCamera.aspect = sizes.width / sizes.height;
  activeCamera.updateProjectionMatrix();

  canvas.width = Math.round(sizes.width * sizes.pixelRatio);
  canvas.height = Math.round(sizes.height * sizes.pixelRatio);
  canvas.style.width = `${sizes.width}px`;
  canvas.style.height = `${sizes.height}px`;

  context.setTransform(sizes.pixelRatio, 0, 0, sizes.pixelRatio, 0, 0);
  drawFrame(Math.max(state.renderedFrame, 0));
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
  activeCamera.position.set(center.x, center.y + size.y * 0.08, center.z + maxSize * 1.9);
  activeCamera.lookAt(center);
  activeCamera.updateProjectionMatrix();
}

function syncActiveCamera() {
  if (!animatedCamera || !animatedCamera.isPerspectiveCamera) {
    return;
  }

  activeCamera.position.copy(animatedCamera.position);
  activeCamera.quaternion.copy(animatedCamera.quaternion);
  activeCamera.scale.copy(animatedCamera.scale);
  activeCamera.fov = animatedCamera.fov;
  activeCamera.near = animatedCamera.near;
  activeCamera.far = animatedCamera.far;
  activeCamera.zoom = animatedCamera.zoom;
  activeCamera.updateProjectionMatrix();
}

function loadEnvironment() {
  const rgbeLoader = new RGBELoader();
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  rgbeLoader.load(
    '/hdr/brown_photostudio_02_1k.hdr',
    (texture) => {
      const environmentRenderTarget = pmremGenerator.fromEquirectangular(texture);
      scene.environment = environmentRenderTarget.texture;
      texture.dispose();
      pmremGenerator.dispose();
    },
    undefined,
    () => {
      pmremGenerator.dispose();
    }
  );
}

function loadModel() {
  const loader = new GLTFLoader();

  loader.load(
    modelPath,
    (gltf) => {
      fallbackSceneRoot = gltf.scene;
      scene.add(gltf.scene);

      gltf.scene.traverse((child) => {
        if (!animatedCamera && child.isCamera) {
          animatedCamera = child;
        }
      });

      hoverFillGroup = createHoverClone(gltf.scene, 'fill');
      if (hoverFillGroup) {
        hoverFillGroup.visible = false;
        scene.add(hoverFillGroup);
      }

      hoverBloomGroup = createHoverClone(gltf.scene, 'bloom');
      if (hoverBloomGroup) {
        hoverBloomGroup.visible = false;
        bloomScene.add(hoverBloomGroup);
      }

      if (!animatedCamera && gltf.cameras && gltf.cameras.length > 0) {
        animatedCamera = gltf.cameras[0];
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
      }

      if (animatedCamera) {
        animatedCamera.aspect = sizes.width / sizes.height;
        animatedCamera.updateProjectionMatrix();
        syncActiveCamera();
      } else {
        fitFallbackCamera();
      }

      state.modelReady = true;
      renderer.render(scene, activeCamera);
      bloomRenderer.render(bloomScene, activeCamera);
    }
  );
}

function createHoverClone(root, variant) {
  const clone = root.clone(true);
  let hasMeshes = false;
  let materialIndex = 0;

  clone.traverse((child) => {
    if (child.isCamera || child.isLight) {
      child.visible = false;
      return;
    }

    if (!child.isMesh) {
      return;
    }

    hasMeshes = true;
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    const hoverMaterials = sourceMaterials.map(() => {
      const phase = materialIndex * 0.73;
      materialIndex += 1;

      if (variant === 'fill') {
        const material = new THREE.MeshStandardMaterial({
          color: hoverColor,
          emissive: hoverColor,
          emissiveIntensity: hoverEmissiveIntensity,
          transparent: true,
          opacity: hoverFillOpacity,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1
        });

        material.userData.hoverBaseOpacity = hoverFillOpacity;
        material.userData.hoverBaseEmissiveIntensity = hoverEmissiveIntensity;
        material.userData.hoverPhase = phase;
        hoverAnimatedMaterials.fill.push(material);
        return material;
      }

      if (variant === 'bloom') {
        const material = new THREE.MeshBasicMaterial({
          color: hoverColor,
          transparent: true,
          opacity: hoverBloomOpacity,
          depthWrite: false
        });

        material.userData.hoverBaseOpacity = hoverBloomOpacity;
        material.userData.hoverPhase = phase;
        hoverAnimatedMaterials.bloom.push(material);
        return material;
      }

      return new THREE.MeshBasicMaterial({
        color: hoverColor,
        transparent: true,
        opacity: 0.95,
        side: THREE.BackSide,
        depthWrite: false
      });
    });

    child.material = Array.isArray(child.material) ? hoverMaterials : hoverMaterials[0];

    child.renderOrder = 2;
  });

  return hasMeshes ? clone : null;
}

function drawCoverImage(image) {
  if (!image || !image.complete || image.naturalWidth === 0) {
    return;
  }

  const canvasRatio = sizes.width / sizes.height;
  const imageRatio = image.naturalWidth / image.naturalHeight;

  let drawWidth = sizes.width;
  let drawHeight = sizes.height;
  let drawX = 0;
  let drawY = 0;

  if (imageRatio > canvasRatio) {
    drawHeight = sizes.height;
    drawWidth = drawHeight * imageRatio;
    drawX = (sizes.width - drawWidth) / 2;
  } else {
    drawWidth = sizes.width;
    drawHeight = drawWidth / imageRatio;
    drawY = (sizes.height - drawHeight) / 2;
  }

  context.clearRect(0, 0, sizes.width, sizes.height);
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

function drawFrame(frameIndex) {
  const safeIndex = wrapFrame(frameIndex);
  const frameRecord = imagesByColor[state.currentColor][safeIndex];
  const image = frameRecord?.image;

  if (!image || !image.complete) {
    ensureFrameLoaded(state.currentColor, safeIndex);
    return;
  }

  state.renderedFrame = safeIndex;
  frameIndicatorElement.textContent = `${sequenceVariants[state.currentColor]}${String(safeIndex).padStart(4, '0')}.webp | glb${String(currentModelFrame).padStart(4, '0')}`;
  drawCoverImage(image);
}

function updateCompareMode() {
  const mode = compareModes[state.compareModeIndex];
  document.body.dataset.compareMode = mode;
  compareModeElement.textContent = mode === 'overlay' ? 'Overlay' : mode === 'sequence' ? 'Solo secuencia' : 'Solo GLB';
}

function setModelHoverState(value) {
  if (state.isHoveringModel === value) {
    return;
  }

  state.isHoveringModel = value;
  document.body.classList.toggle('is-hovering-model', value);

  if (hoverFillGroup) {
    hoverFillGroup.visible = value;
  }

  if (hoverBloomGroup) {
    hoverBloomGroup.visible = value;
  }
}

function updateColorMenu() {
  colorMenuElement.classList.toggle('is-visible', state.isColorMenuVisible);

  colorButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.color === state.currentColor);
  });
}

function showColorMenu() {
  state.isColorMenuVisible = true;
  updateColorMenu();
}

function hideColorMenu() {
  state.isColorMenuVisible = false;
  updateColorMenu();
}

function selectColor(colorKey) {
  if (!sequenceVariants[colorKey]) {
    return;
  }

  state.currentColor = colorKey;
  syncFrameCache(Math.round(state.currentFrame));
  updateColorMenu();
  drawFrame(Math.round(state.currentFrame));
}

function updatePointerFromEvent(event) {
  const rect = modelCanvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function isPointerOverModel() {
  if (!state.modelReady || !fallbackSceneRoot) {
    return false;
  }

  raycaster.setFromCamera(pointer, activeCamera);
  const hits = raycaster.intersectObject(fallbackSceneRoot, true);
  return hits.some((hit) => hit.object?.isMesh);
}

function updateModelHover() {
  if (state.isDragging) {
    setModelHoverState(false);
    return;
  }

  setModelHoverState(isPointerOverModel());
}

function setDragging(value) {
  state.isDragging = value;
  document.body.classList.toggle('is-dragging', value);
}

function onPointerDown(event) {
  setDragging(true);
  setModelHoverState(false);
  state.activePointerId = event.pointerId;
  state.dragStartX = event.clientX;
  state.dragStartFrame = state.currentFrame;
  state.lastPointerX = event.clientX;
  state.lastPointerTime = performance.now();
  state.lastDragDeltaFrame = 0;
  state.lastDragDeltaTime = 16.6667;
  state.pointerDownDistance = 0;
  state.velocity = 0;
}

function onPointerMove(event) {
  updatePointerFromEvent(event);
  updateModelHover();

  if (!state.isDragging || event.pointerId !== state.activePointerId) {
    return;
  }

  const deltaX = event.clientX - state.dragStartX;
  state.currentFrame = wrapFrame(state.dragStartFrame - deltaX * dragSensitivity);
  state.pointerDownDistance = Math.max(state.pointerDownDistance, Math.abs(deltaX));

  const now = performance.now();
  const deltaPointer = event.clientX - state.lastPointerX;
  const deltaTime = Math.max(now - state.lastPointerTime, 1);
  const deltaFrame = -(deltaPointer * dragSensitivity);

  state.velocity = deltaFrame / deltaTime;
  state.lastDragDeltaFrame = deltaFrame;
  state.lastDragDeltaTime = deltaTime;
  state.lastPointerX = event.clientX;
  state.lastPointerTime = now;
}

function endDrag(event) {
  if (!state.isDragging || (event?.pointerId !== undefined && event.pointerId !== state.activePointerId)) {
    return;
  }

  if (Math.abs(state.lastDragDeltaFrame) > 0) {
    state.velocity = state.lastDragDeltaFrame / Math.max(state.lastDragDeltaTime, 1);
  }

  updatePointerFromEvent(event);
  const shouldOpenColorMenu = state.pointerDownDistance < 6 && isPointerOverModel();

  setDragging(false);
  state.activePointerId = null;
  updateModelHover();

  if (shouldOpenColorMenu) {
    showColorMenu();
  }
}

function clearModelHover() {
  pointer.set(2, 2);
  setModelHoverState(false);
}

function cancelInteraction() {
  setDragging(false);
  state.activePointerId = null;
  state.velocity = 0;
  clearModelHover();
}

function updateHoverPulse(now) {
  const isAnimated = state.isHoveringModel && !state.isDragging;
  const pulse = 0.5 + 0.5 * Math.sin(now * hoverPulseSpeed);

  hoverAnimatedMaterials.fill.forEach((material) => {
    const phase = material.userData.hoverPhase ?? 0;
    const baseOpacity = material.userData.hoverBaseOpacity ?? hoverFillOpacity;
    const baseEmissiveIntensity = material.userData.hoverBaseEmissiveIntensity ?? hoverEmissiveIntensity;
    const noise =
      0.5 +
      0.5 *
        Math.sin(now * 0.0037 + phase * 1.17) *
        Math.cos(now * 0.0049 + phase * 0.61);

    if (!isAnimated) {
      material.opacity = baseOpacity;
      material.emissiveIntensity = baseEmissiveIntensity;
      return;
    }

    material.opacity =
      baseOpacity *
      (1 + (pulse - 0.5) * 2 * hoverPulseAmount + (noise - 0.5) * 2 * hoverNoiseAmount);
    material.emissiveIntensity =
      baseEmissiveIntensity *
      (1 + (pulse - 0.5) * 2 * (hoverPulseAmount * 1.35) + (noise - 0.5) * 2 * (hoverNoiseAmount * 0.85));
  });

  hoverAnimatedMaterials.bloom.forEach((material) => {
    const phase = material.userData.hoverPhase ?? 0;
    const baseOpacity = material.userData.hoverBaseOpacity ?? hoverBloomOpacity;
    const noise =
      0.5 +
      0.5 *
        Math.sin(now * 0.0043 + phase * 0.92) *
        Math.cos(now * 0.0031 + phase * 1.41);

    if (!isAnimated) {
      material.opacity = baseOpacity;
      return;
    }

    material.opacity =
      baseOpacity *
      (1 + (pulse - 0.5) * 2 * (hoverPulseAmount * 1.15) + (noise - 0.5) * 2 * (hoverNoiseAmount * 1.1));
  });
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointerleave', clearModelHover);
modelCanvas.addEventListener('pointerdown', onPointerDown);
modelCanvas.addEventListener('pointerleave', clearModelHover);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', cancelInteraction);
window.addEventListener('resize', resizeCanvas);
window.addEventListener('pointerdown', (event) => {
  if (colorMenuElement.contains(event.target)) {
    return;
  }

  if (!(event.target instanceof HTMLCanvasElement)) {
    hideColorMenu();
  }
});
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'v') {
    return;
  }

  state.compareModeIndex = (state.compareModeIndex + 1) % compareModes.length;
  updateCompareMode();
});

colorButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectColor(button.dataset.color);
  });
});

let lastTickTime = performance.now();

function tick() {
  const now = performance.now();
  const deltaMs = Math.min(now - lastTickTime, 32);
  lastTickTime = now;

  if (!state.isDragging && Math.abs(state.velocity) > minimumVelocity) {
    state.currentFrame = wrapFrame(state.currentFrame + state.velocity * deltaMs);
    state.velocity *= Math.pow(inertiaDamping, deltaMs / 16.6667);

    if (Math.abs(state.velocity) <= minimumVelocity) {
      state.velocity = 0;
    }
  }

  currentModelFrame = wrapFrame(Math.round(state.currentFrame));

  if (currentModelFrame !== state.cacheCenterFrame) {
    state.cacheCenterFrame = currentModelFrame;
    syncFrameCache(currentModelFrame);
  }

  updateHoverPulse(now);

  if (state.modelReady && animationMixer && clipDuration > 0) {
    const clipProgress = currentModelFrame / (totalFrames - 1);
    const safeTime = Math.min(clipProgress * clipDuration, Math.max(clipDuration - 0.0001, 0));
    animationMixer.setTime(safeTime);
    syncActiveCamera();
  }

  drawFrame(Math.round(state.currentFrame));
  renderer.render(scene, activeCamera);
  bloomRenderer.render(bloomScene, activeCamera);
  window.requestAnimationFrame(tick);
}

updateCompareMode();
updateColorMenu();
updateLoadingProgress();
syncFrameCache(0);
loadEnvironment();
loadModel();
resizeCanvas();
tick();
