// Seam VR - Main entry point.

import * as THREE from 'three';

import { SceneGraph } from './core/scene-graph';
import { SceneAnchorManager } from './core/scene-anchor-manager';
import { CommandBus } from './core/command-bus';
import { registerAllCommands } from './core/commands';
import { initTestHarness } from './test-harness/harness';

import { setupEnvironment, createGroundGrid } from './rendering/environment';
import { createOrbitCamera, updateOrbitCamera } from './viewer/orbit-camera';
import { SelectionOutline } from './rendering/selection-outline';
import { LightGizmo } from './rendering/light-gizmo';

import { XRSessionManager } from './xr/xr-session';
import { XRControllerTracker } from './xr/xr-controller';
import { XREmulator } from './xr/xr-emulator';
import { XRInputHandler } from './xr/xr-input-handler';

import { InteractionManager } from './interaction/interaction-manager';
import { ToolSystem } from './interaction/tool-system';
import { BrushPreview } from './interaction/brush-preview';
import { WorldNavigation } from './interaction/world-navigation';
import { LayerGrabSystem } from './interaction/layer-grab-system';
import { SelectionManager } from './interaction/selection-manager';

import { AnimationSystem } from './animation/animation-system';
import { TimelineController } from './animation/timeline-controller';

import { UIManager } from './ui/ui-manager';

import { ClayManager } from './sculpting/clay-manager';
import { SculptInteraction } from './sculpting/sculpt-interaction';

async function init() {
  const container = document.getElementById('canvas-container')!;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    100
  );
  camera.position.set(0, 1.6, 3);

  const worldGroup = new THREE.Group();
  worldGroup.name = 'world_content';
  scene.add(worldGroup);

  setupEnvironment(worldGroup);
  createGroundGrid(worldGroup);

  const sceneGraph = new SceneGraph();
  const commandBus = new CommandBus(sceneGraph);
  registerAllCommands(commandBus, sceneGraph);
  const sceneAnchorManager = new SceneAnchorManager(sceneGraph, worldGroup);

  const orbitControls = createOrbitCamera(camera, renderer.domElement);

  const xrSession = new XRSessionManager(renderer);
  const vrButton = document.getElementById('vr-button') as HTMLButtonElement;
  const xrSupported = await xrSession.isSupported();
  if (xrSupported) {
    vrButton.classList.add('visible');
    xrSession.setupVRButton(vrButton);
  }

  const controllerTracker = new XRControllerTracker(renderer);
  const xrEmulator = new XREmulator();
  let useEmulator = !xrSupported;

  xrSession.onSessionStart = () => {
    useEmulator = false;
    controllerTracker.setupControllers(scene);
    orbitControls.enabled = false;
  };

  xrSession.onSessionEnd = () => {
    useEmulator = true;
    orbitControls.enabled = true;
  };

  const toolSystem = new ToolSystem();
  const clayManager = new ClayManager(sceneGraph, worldGroup);
  const sculptInteraction = new SculptInteraction(clayManager);
  const brushPreview = new BrushPreview(scene, toolSystem);

  const animationSystem = new AnimationSystem();
  const timelineController = new TimelineController();

  const uiManager = new UIManager(scene, commandBus, timelineController, toolSystem, sceneGraph, worldGroup);
  uiManager.setCamera(camera);
  uiManager.setClayManager(clayManager);
  uiManager.radialMenuL.setCamera(camera);
  uiManager.radialMenuR.setCamera(camera);
  toolSystem.onToolChange = (hand, tool) => {
    uiManager.handleToolChange(hand, tool);
  };

  const selectionManager = new SelectionManager(sceneGraph, worldGroup);
  const selectionOutline = new SelectionOutline();
  const lightGizmo = new LightGizmo();

  selectionManager.onChange((nodeId, node) => {
    uiManager.setSelection(nodeId, node);

    selectionOutline.clear();
    lightGizmo.clear();

    const targetObject = node?.object3D ?? node?.mesh ?? null;
    if (targetObject) {
      selectionOutline.setTargetObject(targetObject);
    }

    if (node?.layerType === 'light') {
      lightGizmo.setTarget(node);
    }
  });

  uiManager.onHierarchySelect((nodeId) => {
    selectionManager.selectById(nodeId);
  });

  const inputHandler = new XRInputHandler(xrEmulator);
  const inputHandlerVR = new XRInputHandler(controllerTracker);
  const worldNavigation = new WorldNavigation(worldGroup);
  const layerGrabSystem = new LayerGrabSystem(sceneGraph, commandBus);

  const interactionManager = new InteractionManager(
    xrEmulator,
    inputHandler,
    toolSystem,
    sculptInteraction,
    brushPreview,
    uiManager.radialMenuL,
    uiManager.radialMenuR,
    commandBus,
  );
  interactionManager.setWorldNavigation(worldNavigation);
  interactionManager.setLayerGrabSystem(layerGrabSystem);
  interactionManager.setSelectionManager(selectionManager);
  interactionManager.setPanelProvider(() => uiManager.getPanels());
  interactionManager.setUIPanelActions({
    detachPanel: (panel) => uiManager.detachPanel(panel),
  });

  const interactionManagerVR = new InteractionManager(
    controllerTracker,
    inputHandlerVR,
    toolSystem,
    sculptInteraction,
    brushPreview,
    uiManager.radialMenuL,
    uiManager.radialMenuR,
    commandBus,
  );
  interactionManagerVR.setWorldNavigation(worldNavigation);
  interactionManagerVR.setLayerGrabSystem(layerGrabSystem);
  interactionManagerVR.setSelectionManager(selectionManager);
  interactionManagerVR.setPanelProvider(() => uiManager.getPanels());
  interactionManagerVR.setUIPanelActions({
    detachPanel: (panel) => uiManager.detachPanel(panel),
  });

  initTestHarness(commandBus, sceneGraph);
  window.__seam.toolSystem = toolSystem;
  window.__seam.camera = camera;
  (window.__seam as any).clayManager = clayManager;
  (window.__seam as any)._setUI(uiManager);
  (window.__seam as any)._setSelection(selectionManager);
  (window.__seam as any)._setOrbitControls(orbitControls);

  const origExec = commandBus.exec.bind(commandBus);
  commandBus.exec = (cmd) => {
    if (cmd.cmd.startsWith('xr_')) {
      xrEmulator.handleCommand(cmd);
      return;
    }
    origExec(cmd);
  };

  commandBus.exec({
    cmd: 'create_clay',
    id: 'clay_1',
    position: [0, 1.2, 0],
  });
  sceneAnchorManager.syncAll();
  await clayManager.syncAll();
  selectionManager.selectById('clay_1');

  const handleResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', handleResize);

  const clock = new THREE.Clock();
  let frameCount = 0;
  let frameTotalMs = 0;

  renderer.setAnimationLoop(() => {
    const frameStart = performance.now();
    const deltaTime = clock.getDelta();

    const time = timelineController.update(deltaTime);
    if (timelineController.state === 'playing') {
      animationSystem.evaluate(time, sceneGraph);
    }

    if (useEmulator) {
      xrEmulator.update();
      uiManager.updateHandAnchors(xrEmulator.left, xrEmulator.right);
      interactionManager.update();
    } else if (xrSession.isInVR()) {
      controllerTracker.update();
      uiManager.updateHandAnchors(controllerTracker.left, controllerTracker.right);
      interactionManagerVR.update();
    }

    if (!xrSession.isInVR()) {
      updateOrbitCamera(orbitControls);
    }

    uiManager.update();
    selectionOutline.update();

    const renderStart = performance.now();
    renderer.render(scene, camera);
    const renderMs = performance.now() - renderStart;

    const frameMs = performance.now() - frameStart;
    frameTotalMs += frameMs;
    frameCount++;
    if (frameCount >= 120) {
      const avg = frameTotalMs / frameCount;
      const info = renderer.info;
      console.log(
        `[Frame] avg: ${avg.toFixed(1)}ms, render: ${renderMs.toFixed(1)}ms, ` +
        `drawCalls: ${info.render.calls}, triangles: ${info.render.triangles}, ` +
        `geometries: ${info.memory.geometries}, textures: ${info.memory.textures}`
      );
      frameCount = 0;
      frameTotalMs = 0;
    }
  });

  console.log('[Seam VR] Fully initialized');
}

init().catch(console.error);
