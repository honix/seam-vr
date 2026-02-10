// Seam VR - Main entry point
// Bootstrap renderer, scene graph, command bus, and all subsystems

import * as THREE from 'three';

// Core
import { SceneGraph } from './core/scene-graph';
import { CommandBus } from './core/command-bus';
import { registerAllCommands } from './core/commands';
import { initTestHarness } from './test-harness/harness';

// Rendering
import { RenderPipeline } from './rendering/render-pipeline';
import { setupEnvironment, createGroundGrid } from './rendering/environment';
import { createOrbitCamera, updateOrbitCamera } from './viewer/orbit-camera';

// XR
import { XRSessionManager } from './xr/xr-session';
import { XRControllerTracker } from './xr/xr-controller';
import { XREmulator } from './xr/xr-emulator';
import { XRInputHandler } from './xr/xr-input-handler';

// Interaction
import { InteractionManager } from './interaction/interaction-manager';
import { GrabSystem } from './interaction/grab-system';
import { HandleSystem } from './interaction/handle-system';
import { ModeManager } from './interaction/mode-manager';

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

  // --- Environment ---
  setupEnvironment(scene);
  createGroundGrid(scene);

  // --- Core Systems ---
  const sceneGraph = new SceneGraph();
  const commandBus = new CommandBus(sceneGraph);
  registerAllCommands(commandBus, sceneGraph);

  // --- Render Pipeline ---
  const renderPipeline = new RenderPipeline(renderer, scene, camera);
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
    orbitControls.enabled = false; // Disable orbit in VR
  };

  xrSession.onSessionEnd = () => {
    useEmulator = true;
    orbitControls.enabled = true;
  };

  // --- Input Handler ---
  // XRInputHandler works with both real and emulated controllers
  const inputHandler = new XRInputHandler(xrEmulator);
  const inputHandlerVR = new XRInputHandler(controllerTracker);

  // --- Interaction Systems ---
  const modeManager = new ModeManager();
  const grabSystem = new GrabSystem(scene, sceneGraph, commandBus);
  const handleSystem = new HandleSystem(scene, sceneGraph, commandBus);

  // --- Animation ---
  const animationSystem = new AnimationSystem();
  const timelineController = new TimelineController();

  // --- UI ---
  const uiManager = new UIManager(scene, commandBus, timelineController);

  // --- Interaction Manager ---
  const interactionManager = new InteractionManager(
    xrEmulator,
    inputHandler,
    modeManager,
    grabSystem,
    handleSystem,
    commandBus,
    uiManager.palette
  );

  const interactionManagerVR = new InteractionManager(
    controllerTracker,
    inputHandlerVR,
    modeManager,
    grabSystem,
    handleSystem,
    commandBus,
    uiManager.palette
  );

  // --- Sculpting ---
  const sculptEngine = new SculptEngine(scene);
  await sculptEngine.initGPU();
  const sculptInteraction = new SculptInteraction(sculptEngine);

  // --- Test Harness ---
  initTestHarness(commandBus, sceneGraph);

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

  // --- Render Loop ---
  renderer.setAnimationLoop(() => {
    const deltaTime = clock.getDelta();

    // Update animation
    const time = timelineController.update(deltaTime);
    if (timelineController.state === 'playing') {
      animationSystem.evaluate(time, sceneGraph);
    }

    // Update input and interaction
    if (useEmulator) {
      xrEmulator.update();
      if (modeManager.currentMode === 'sculpt') {
        sculptInteraction.update(xrEmulator.right, xrEmulator.left);
      } else {
        interactionManager.update();
      }
    } else if (xrSession.isInVR()) {
      controllerTracker.update();
      if (modeManager.currentMode === 'sculpt') {
        sculptInteraction.update(controllerTracker.right, controllerTracker.left);
      } else {
        interactionManagerVR.update();
      }
    }

    // Update orbit camera (only when not in VR)
    if (!xrSession.isInVR()) {
      updateOrbitCamera(orbitControls);
    }

    // Update UI
    uiManager.update();

    // Render
    renderer.render(scene, camera);
  });

  console.log('[Seam VR] Fully initialized');
  console.log('[Seam VR] Test harness: window.__seam.exec({cmd:"spawn", type:"cylinder", id:"test1", position:[0,1,0]})');
}

init().catch(console.error);
