// Seam VR - Main entry point
// Bootstrap renderer, scene graph, command bus, and all subsystems

import * as THREE from 'three';

// Core
import { SceneGraph, SceneNode } from './core/scene-graph';
import { CommandBus } from './core/command-bus';
import { registerAllCommands } from './core/commands';
import { initTestHarness } from './test-harness/harness';

// Rendering
import { RenderPipeline } from './rendering/render-pipeline';
import { setupEnvironment, createGroundGrid } from './rendering/environment';
import { createOrbitCamera, updateOrbitCamera } from './viewer/orbit-camera';
import { SelectionOutline } from './rendering/selection-outline';
import { LightGizmo } from './rendering/light-gizmo';

// XR
import { XRSessionManager } from './xr/xr-session';
import { XRControllerTracker } from './xr/xr-controller';
import { XREmulator } from './xr/xr-emulator';
import { XRInputHandler } from './xr/xr-input-handler';

// Interaction
import { InteractionManager } from './interaction/interaction-manager';
import { ToolSystem } from './interaction/tool-system';
import { BrushPreview } from './interaction/brush-preview';
import { WorldNavigation } from './interaction/world-navigation';
import { LayerGrabSystem } from './interaction/layer-grab-system';
import { SelectionManager } from './interaction/selection-manager';

// Animation
import { AnimationSystem } from './animation/animation-system';
import { TimelineController } from './animation/timeline-controller';

// UI
import { UIManager } from './ui/ui-manager';

// Sculpting
import { SculptEngine } from './sculpting/sculpt-engine';
import { SculptInteraction } from './sculpting/sculpt-interaction';

async function init() {
  // --- Renderer ---
  const container = document.getElementById('canvas-container')!;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  // --- Scene + Camera ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    100
  );
  camera.position.set(0, 1.6, 3);

  // --- World Group ---
  // All content (environment, grid, sculpt, primitives) goes into worldGroup.
  // Controllers and UI remain direct scene children (XR manages their position).
  // WorldNavigation moves/scales/rotates this group for grip-based navigation.
  const worldGroup = new THREE.Group();
  worldGroup.name = 'world_content';
  scene.add(worldGroup);

  // --- Environment ---
  setupEnvironment(worldGroup);
  createGroundGrid(worldGroup);

  // --- Core Systems ---
  const sceneGraph = new SceneGraph();
  const commandBus = new CommandBus(sceneGraph);
  registerAllCommands(commandBus, sceneGraph);

  // --- Render Pipeline ---
  const renderPipeline = new RenderPipeline(renderer, scene, camera);
  renderPipeline.setContentParent(worldGroup);
  renderPipeline.connectCommandBus(commandBus, sceneGraph);

  // --- Orbit Camera (flat-screen fallback) ---
  const orbitControls = createOrbitCamera(camera, renderer.domElement);

  // --- XR Setup ---
  const xrSession = new XRSessionManager(renderer);
  const vrButton = document.getElementById('vr-button') as HTMLButtonElement;

  // Check XR support and show button
  const xrSupported = await xrSession.isSupported();
  if (xrSupported) {
    vrButton.classList.add('visible');
    xrSession.setupVRButton(vrButton);
  }

  // XR controllers (real) + emulator (desktop testing)
  const controllerTracker = new XRControllerTracker(renderer);
  const xrEmulator = new XREmulator();

  // Use real controllers in VR, emulator on desktop
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

  // --- Tool System ---
  const toolSystem = new ToolSystem();

  // --- Sculpting ---
  const sculptEngine = new SculptEngine(scene);
  await sculptEngine.initGPU();
  // Reparent sculpt group from scene into worldGroup so it moves with world navigation
  scene.remove(sculptEngine.sculptGroup);
  worldGroup.add(sculptEngine.sculptGroup);
  const sculptInteraction = new SculptInteraction(sculptEngine);

  // --- Register sculpt volume as scene node ---
  const sculptNode = new SceneNode('sculpt_volume', 'sphere');
  sculptNode.nodeType = 'sculpt_volume';
  sculptNode.layerType = 'sculpt';
  sculptNode.mesh = null;
  sceneGraph.addNode(sculptNode);

  // --- Brush Preview ---
  const brushPreview = new BrushPreview(scene, toolSystem);

  // --- Animation ---
  const animationSystem = new AnimationSystem();
  const timelineController = new TimelineController();

  // --- UI ---
  const uiManager = new UIManager(scene, commandBus, timelineController, toolSystem, sceneGraph);
  uiManager.setSculptEngine(sculptEngine);
  uiManager.radialMenuL.setCamera(camera);
  uiManager.radialMenuR.setCamera(camera);

  // --- Selection System ---
  const selectionManager = new SelectionManager(sceneGraph, worldGroup);
  selectionManager.setSculptEngine(sculptEngine);

  const selectionOutline = new SelectionOutline();
  const lightGizmo = new LightGizmo();

  // Wire selection changes to inspector, hierarchy, outline, and gizmo
  selectionManager.onChange((nodeId, node) => {
    // Update inspector
    uiManager.inspector.setSelectedNode(node ?? null);

    // Update hierarchy highlight
    uiManager.hierarchy.setSelectedNodeId(nodeId);

    // Update selection outline
    selectionOutline.clear();
    lightGizmo.clear();

    if (node) {
      if (node.nodeType === 'sculpt_volume') {
        selectionOutline.setTargetGroup(sculptEngine.sculptGroup);
      } else if (node.mesh) {
        selectionOutline.setTarget(node);
      }

      // Show light gizmo for light nodes
      if (node.layerType === 'light') {
        lightGizmo.setTarget(node);
      }
    }
  });

  // Wire hierarchy row clicks to selection
  uiManager.hierarchy.onSelect((nodeId) => {
    selectionManager.selectById(nodeId);
  });

  // --- Input Handlers ---
  const inputHandler = new XRInputHandler(xrEmulator);
  const inputHandlerVR = new XRInputHandler(controllerTracker);

  // --- World Navigation ---
  const worldNavigation = new WorldNavigation(worldGroup);

  // --- Layer Grab System ---
  const layerGrabSystem = new LayerGrabSystem(sceneGraph, commandBus);

  // --- Interaction Manager (emulator) ---
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
  interactionManager.setPanels(uiManager.getPanels());
  interactionManager.setUICallbacks({
    toggleInspector: (pos) => uiManager.toggleInspector(pos),
    toggleHierarchy: (pos) => uiManager.toggleHierarchy(pos),
  });

  // --- Interaction Manager (VR) ---
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
  interactionManagerVR.setPanels(uiManager.getPanels());
  interactionManagerVR.setUICallbacks({
    toggleInspector: (pos) => uiManager.toggleInspector(pos),
    toggleHierarchy: (pos) => uiManager.toggleHierarchy(pos),
  });

  // --- Test Harness ---
  initTestHarness(commandBus, sceneGraph);
  window.__seam.sculptEngine = sculptEngine;
  window.__seam.toolSystem = toolSystem;
  window.__seam.camera = camera;

  // Wire emulator commands through the test harness
  const origExec = commandBus.exec.bind(commandBus);
  commandBus.exec = (cmd) => {
    // Route XR emulation commands to emulator
    if (cmd.cmd.startsWith('xr_')) {
      xrEmulator.handleCommand(cmd);
      return;
    }
    origExec(cmd);
  };

  // --- Resize Handler ---
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Clock for deltaTime ---
  const clock = new THREE.Clock();

  // --- Frame timing ---
  let frameCount = 0;
  let frameTotalMs = 0;

  // --- Render Loop ---
  renderer.setAnimationLoop(() => {
    const frameStart = performance.now();
    const deltaTime = clock.getDelta();

    // Update animation
    const time = timelineController.update(deltaTime);
    if (timelineController.state === 'playing') {
      animationSystem.evaluate(time, sceneGraph);
    }

    // Update input and interaction (unified - no mode branching)
    if (useEmulator) {
      xrEmulator.update();
      interactionManager.update();
    } else if (xrSession.isInVR()) {
      controllerTracker.update();
      interactionManagerVR.update();
    }

    // Update orbit camera (only when not in VR)
    if (!xrSession.isInVR()) {
      updateOrbitCamera(orbitControls);
    }

    // Update UI
    uiManager.update();

    // Update selection outline (box helper needs per-frame update)
    selectionOutline.update();

    // Render
    const renderStart = performance.now();
    renderer.render(scene, camera);
    const renderMs = performance.now() - renderStart;

    // Log frame timing every 120 frames (~2 seconds)
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
  console.log('[Seam VR] Test harness: window.__seam.exec({cmd:"spawn", type:"cylinder", id:"test1", position:[0,1,0]})');
}

init().catch(console.error);
