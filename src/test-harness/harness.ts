import * as THREE from 'three';
import { CommandBus, Command } from '../core/command-bus';
import { SceneGraph } from '../core/scene-graph';
import { serializeScene, serializeNodeById } from '../core/serialization';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ToolSystem, ToolId } from '../interaction/tool-system';
import type { UIManager } from '../ui/ui-manager';
import type { SelectionManager } from '../interaction/selection-manager';
import type { Vec3, Hand, Vec4 } from '../types';
import type { XREmulator } from '../xr/xr-emulator';
import type { ClayManager } from '../sculpting/clay-manager';
import type { TimelineController } from '../animation/timeline-controller';
import type { AnimationSystem } from '../animation/animation-system';
import { PlayRunner } from './play-runner';
import { PLAY_SCENARIOS } from './play-registry';
import type { PlayFrameSample, PlayRunResult } from './play-types';

const DEFAULT_RIGHT_HAND_POSITION: Vec3 = [0.2, 1.2, -0.4];
const DEFAULT_LEFT_HAND_POSITION: Vec3 = [-0.2, 1.2, -0.4];
const DEFAULT_HAND_ROTATION: Vec4 = [0, 0, 0, 1];
const DEFAULT_CAMERA_POSITION: Vec3 = [0, 1.6, 3];
const DEFAULT_CAMERA_TARGET: Vec3 = [0, 0.5, 0];
const DEFAULT_CLAY_POSITION: Vec3 = [0, 1.2, 0];
const DEFAULT_CLAY_SEED_CENTER_LOCAL: Vec3 = [0.06, 0.06, 0.06];
const DEFAULT_CLAY_SEED_RADIUS = 0.09;
export const DEFAULT_CLAY_FOCUS_TARGET: Vec3 = [
  DEFAULT_CLAY_POSITION[0] + DEFAULT_CLAY_SEED_CENTER_LOCAL[0],
  DEFAULT_CLAY_POSITION[1] + DEFAULT_CLAY_SEED_CENTER_LOCAL[1],
  DEFAULT_CLAY_POSITION[2] + DEFAULT_CLAY_SEED_CENTER_LOCAL[2],
];

export interface TestHarnessOptions {
  commandBus: CommandBus;
  sceneGraph: SceneGraph;
  toolSystem: ToolSystem;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  xrEmulator: XREmulator;
  timelineController: TimelineController;
  animationSystem: AnimationSystem;
}

export interface TestHarnessController {
  onFrame(sample: PlayFrameSample): void;
  autoRunFromUrl(): Promise<void>;
}

declare global {
  interface Window {
    __seam: {
      exec: (cmd: Command) => void;
      scene: () => object;
      node: (id: string) => object | null;
      toolSystem?: ToolSystem;
      camera?: THREE.PerspectiveCamera;
      reset: () => Promise<void>;
      snapshotScene: () => object;
      captureViewport: () => string;
      clayStats: (nodeId?: string) => object | null;
      select: (nodeId: string) => void;
      activateClay: (nodeId: string | null) => void;
      deselect: () => void;
      openInspector: (position?: Vec3) => void;
      closeInspector: () => void;
      openHierarchy: (position?: Vec3) => void;
      closeHierarchy: () => void;
      openTimeline: () => void;
      closeTimeline: () => void;
      panelState: () => object;
      focus: (target: Vec3, distance?: number) => void;
      play: {
        run: (id: string) => Promise<PlayRunResult>;
        list: () => Array<{ id: string; description?: string; tags?: string[] }>;
        lastRun: PlayRunResult | null;
      };
    };
  }
}

export async function seedDefaultHarnessScene(
  commandBus: CommandBus,
  clayManager: ClayManager,
  selectionManager: SelectionManager | null,
): Promise<void> {
  commandBus.exec({
    cmd: 'create_clay',
    id: 'clay_1',
    position: DEFAULT_CLAY_POSITION,
  });
  await clayManager.syncAll();
  clayManager.setActiveClay('clay_1');
  const engine = clayManager.getEngine('clay_1');
  if (!engine) {
    throw new Error('Baseline clay engine was not created');
  }
  await engine.seedSphere(DEFAULT_CLAY_SEED_CENTER_LOCAL, DEFAULT_CLAY_SEED_RADIUS);
  selectionManager?.selectById('clay_1');
  commandBus.clearHistory();
}

export function initTestHarness(options: TestHarnessOptions): TestHarnessController {
  const {
    commandBus,
    sceneGraph,
    toolSystem,
    camera,
    renderer,
    xrEmulator,
    timelineController,
    animationSystem,
  } = options;

  let uiManager: UIManager | null = null;
  let selectionManager: SelectionManager | null = null;
  let orbitControls: OrbitControls | null = null;
  let clayManager: ClayManager | null = null;

  const restoreCamera = (): void => {
    camera.position.set(...DEFAULT_CAMERA_POSITION);
    const target = new THREE.Vector3(...DEFAULT_CAMERA_TARGET);
    camera.lookAt(target);
    if (orbitControls) {
      orbitControls.target.copy(target);
      orbitControls.update();
    }
  };

  const applyHandAnchors = (left = DEFAULT_LEFT_HAND_POSITION, right = DEFAULT_RIGHT_HAND_POSITION): void => {
    uiManager?.updateHandAnchors(
      {
        ...xrEmulator.left,
        position: left,
        rotation: DEFAULT_HAND_ROTATION,
      },
      {
        ...xrEmulator.right,
        position: right,
        rotation: DEFAULT_HAND_ROTATION,
      },
    );
  };

  const focus = (target: Vec3, distance = 0.6): void => {
    const t = new THREE.Vector3(target[0], target[1], target[2]);
    camera.position.set(t.x, t.y, t.z + distance);
    camera.lookAt(t);
    if (orbitControls) {
      orbitControls.target.copy(t);
      orbitControls.update();
    }
  };

  const resetHarness = async (): Promise<void> => {
    xrEmulator.reset();
    timelineController.stop();
    animationSystem.clear();
    uiManager?.resetForHarness();
    selectionManager?.selectById(null);
    toolSystem.setTool('left', 'select');
    toolSystem.setTool('right', 'select');
    sceneGraph.clear();
    commandBus.clearHistory();
    restoreCamera();

    if (!clayManager) {
      throw new Error('ClayManager is not attached to the test harness');
    }

    await seedDefaultHarnessScene(commandBus, clayManager, selectionManager);
    applyHandAnchors();
  };

  const playApi = {
    run: (async (_id: string): Promise<PlayRunResult> => {
      throw new Error('Play runner not initialized');
    }) as (id: string) => Promise<PlayRunResult>,
    list: () => [] as Array<{ id: string; description?: string; tags?: string[] }>,
    lastRun: null as PlayRunResult | null,
  };

  const getClayStats = (nodeId?: string): object | null => {
    const id = nodeId ?? clayManager?.getActiveClayId() ?? null;
    if (!id) return null;

    const node = sceneGraph.getNode(id);
    const engine = clayManager?.getEngine(id) ?? null;
    const anchor = node?.object3D ?? node?.mesh ?? null;
    if (!anchor) {
      return {
        id,
        activeClayId: clayManager?.getActiveClayId() ?? null,
        stats: engine?.getStats() ?? null,
        childCount: 0,
        visible: false,
        worldPosition: null,
      };
    }

    anchor.updateWorldMatrix(true, false);
    const worldPosition = new THREE.Vector3();
    anchor.getWorldPosition(worldPosition);

    return {
      id,
      activeClayId: clayManager?.getActiveClayId() ?? null,
      stats: engine?.getStats() ?? null,
      childCount: anchor.children.length,
      visible: anchor.visible,
      worldPosition: [worldPosition.x, worldPosition.y, worldPosition.z],
    };
  };

  const playRunner = new PlayRunner({
    scenarios: PLAY_SCENARIOS,
    actions: {
      exec(cmd) {
        commandBus.exec(cmd);
      },
      select(nodeId) {
        selectionManager?.selectById(nodeId);
      },
      activateClay(nodeId) {
        clayManager?.setActiveClay(nodeId);
      },
      setTool(hand: Hand, tool: ToolId) {
        toolSystem.setTool(hand, tool);
      },
      panelState() {
        const panels = uiManager?.getPanels() ?? [];
        return {
          openPanels: panels.map((panel) => ({
            kind: (panel as { panelKind?: string }).panelKind ?? 'panel',
            hostMode: panel.hostMode,
            isOpen: panel.isOpen,
          })),
        };
      },
      xrPose(hand, position, rotation) {
        commandBus.exec({ cmd: 'xr_pose', hand, position, rotation });
      },
      xrButton(hand, button, pressed) {
        commandBus.exec({ cmd: 'xr_button', hand, button, pressed });
      },
      xrThumbstick(hand, x, y) {
        commandBus.exec({ cmd: 'xr_thumbstick', hand, x, y });
      },
      focus,
      reset: resetHarness,
      snapshotScene() {
        return serializeScene(sceneGraph);
      },
      clayStats(nodeId?: string) {
        return getClayStats(nodeId);
      },
      captureViewport() {
        return renderer.domElement.toDataURL('image/png');
      },
    },
    onLastRunChanged(result) {
      playApi.lastRun = result;
    },
  });

  playApi.run = (id: string) => playRunner.run(id);
  playApi.list = () => playRunner.list();

  window.__seam = {
    exec(cmd: Command) {
      commandBus.exec(cmd);
    },
    scene() {
      return serializeScene(sceneGraph);
    },
    node(id: string) {
      return serializeNodeById(sceneGraph, id);
    },
    toolSystem,
    camera,
    reset: resetHarness,
    snapshotScene() {
      return serializeScene(sceneGraph);
    },
    captureViewport() {
      return renderer.domElement.toDataURL('image/png');
    },
    clayStats(nodeId?: string) {
      return getClayStats(nodeId);
    },
    select(nodeId: string) {
      selectionManager?.selectById(nodeId);
    },
    activateClay(nodeId: string | null) {
      clayManager?.setActiveClay(nodeId);
    },
    deselect() {
      selectionManager?.selectById(null);
    },
    openInspector(position?: Vec3) {
      if (position) {
        applyHandAnchors(DEFAULT_LEFT_HAND_POSITION, position);
      }
      toolSystem.setTool('right', 'inspector');
    },
    closeInspector() {
      toolSystem.setTool('right', 'select');
    },
    openHierarchy(position?: Vec3) {
      if (position) {
        applyHandAnchors(DEFAULT_LEFT_HAND_POSITION, position);
      }
      toolSystem.setTool('right', 'hierarchy');
    },
    closeHierarchy() {
      toolSystem.setTool('right', 'select');
    },
    openTimeline() {
      toolSystem.setTool('right', 'timeline');
    },
    closeTimeline() {
      toolSystem.setTool('right', 'select');
    },
    panelState() {
      return {
        openPanels: (uiManager?.getPanels() ?? []).map((panel) => ({
          kind: (panel as { panelKind?: string }).panelKind ?? 'panel',
          hostMode: panel.hostMode,
          isOpen: panel.isOpen,
        })),
      };
    },
    focus,
    play: playApi,
  };

  (window.__seam as any)._setUI = (ui: UIManager) => { uiManager = ui; };
  (window.__seam as any)._setSelection = (sm: SelectionManager) => { selectionManager = sm; };
  (window.__seam as any)._setOrbitControls = (oc: OrbitControls) => { orbitControls = oc; };
  (window.__seam as any)._setClayManager = (manager: ClayManager) => { clayManager = manager; };

  console.log('[Seam VR] Test harness initialized: window.__seam');

  return {
    onFrame(sample: PlayFrameSample) {
      playRunner.onFrame(sample);
    },
    async autoRunFromUrl() {
      await playRunner.autoRunFromSearch(window.location.search);
    },
  };
}
