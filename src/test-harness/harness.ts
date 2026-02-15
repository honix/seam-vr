import * as THREE from 'three';
import { CommandBus, Command } from '../core/command-bus';
import { SceneGraph } from '../core/scene-graph';
import { serializeScene, serializeNodeById } from '../core/serialization';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SculptEngine } from '../sculpting/sculpt-engine';
import type { ToolSystem } from '../interaction/tool-system';
import type { UIManager } from '../ui/ui-manager';
import type { SelectionManager } from '../interaction/selection-manager';
import type { Vec3 } from '../types';

declare global {
  interface Window {
    __seam: {
      exec: (cmd: Command) => void;
      scene: () => object;
      node: (id: string) => object | null;
      sculptEngine?: SculptEngine;
      toolSystem?: ToolSystem;
      camera?: any;

      // UI testing
      select: (nodeId: string) => void;
      deselect: () => void;
      openInspector: (position?: Vec3) => void;
      closeInspector: () => void;
      openHierarchy: (position?: Vec3) => void;
      closeHierarchy: () => void;
      panelState: () => object;
      focus: (target: Vec3, distance?: number) => void;
    };
  }
}

export function initTestHarness(
  commandBus: CommandBus,
  sceneGraph: SceneGraph
): void {
  let uiManager: UIManager | null = null;
  let selectionManager: SelectionManager | null = null;
  let orbitControls: OrbitControls | null = null;

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

    // --- UI testing ---
    select(nodeId: string) {
      selectionManager?.selectById(nodeId);
    },
    deselect() {
      selectionManager?.selectById('');
    },
    openInspector(position?: Vec3) {
      const pos: Vec3 = position ?? [0.3, 1.2, -0.5];
      uiManager?.toggleInspector(pos);
      if (uiManager && !uiManager.inspector.isOpen) {
        uiManager.toggleInspector(pos); // ensure open
      }
    },
    closeInspector() {
      if (uiManager?.inspector.isOpen) {
        uiManager.inspector.close();
      }
    },
    openHierarchy(position?: Vec3) {
      const pos: Vec3 = position ?? [-0.3, 1.2, -0.5];
      uiManager?.toggleHierarchy(pos);
      if (uiManager && !uiManager.hierarchy.isOpen) {
        uiManager.toggleHierarchy(pos); // ensure open
      }
    },
    closeHierarchy() {
      if (uiManager?.hierarchy.isOpen) {
        uiManager.hierarchy.close();
      }
    },
    panelState() {
      return {
        inspector: {
          isOpen: uiManager?.inspector.isOpen ?? false,
        },
        hierarchy: {
          isOpen: uiManager?.hierarchy.isOpen ?? false,
        },
      };
    },
    focus(target: Vec3, distance = 0.6) {
      const cam = window.__seam.camera as THREE.PerspectiveCamera | undefined;
      if (!cam) return;
      const t = new THREE.Vector3(target[0], target[1], target[2]);
      // Position camera at `distance` in front of the target (along +Z)
      cam.position.set(t.x, t.y, t.z + distance);
      cam.lookAt(t);
      if (orbitControls) {
        orbitControls.target.copy(t);
        orbitControls.update();
      }
    },
  };

  // Expose setters for late-bound dependencies
  (window.__seam as any)._setUI = (ui: UIManager) => { uiManager = ui; };
  (window.__seam as any)._setSelection = (sm: SelectionManager) => { selectionManager = sm; };
  (window.__seam as any)._setOrbitControls = (oc: OrbitControls) => { orbitControls = oc; };

  console.log('[Seam VR] Test harness initialized: window.__seam');
}
