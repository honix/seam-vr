// Central input dispatcher.
// Routes input actions to the appropriate subsystem based on per-hand tool selection.
// No mode-based branching; tools determine behavior.

import * as THREE from 'three';
import { XRControllerTracker } from '../xr/xr-controller';
import { XREmulator } from '../xr/xr-emulator';
import { XRInputHandler, InputAction } from '../xr/xr-input-handler';
import { ToolSystem, isSculptTool, isSpawnTool, isSelectTool } from './tool-system';
import { BrushPreview } from './brush-preview';
import { WorldNavigation } from './world-navigation';
import { LayerGrabSystem } from './layer-grab-system';
import { SelectionManager } from './selection-manager';
import { SculptInteraction } from '../sculpting/sculpt-interaction';
import { RadialMenu } from '../ui/radial-menu';
import { FloatingPanel } from '../ui/floating-panel';
import { CommandBus } from '../core/command-bus';
import type { Vec3 } from '../types';

// Dead zone for trigger analog
const TRIGGER_DEAD_ZONE = 0.1;

function triggerStrength(value: number): number {
  return Math.max(0, (value - TRIGGER_DEAD_ZONE) / (1 - TRIGGER_DEAD_ZONE));
}

// Callbacks for UI tool actions
export interface UICallbacks {
  toggleInspector?: (position: Vec3) => void;
  toggleHierarchy?: (position: Vec3) => void;
}

export class InteractionManager {
  private controllers: XRControllerTracker | XREmulator;
  private inputHandler: XRInputHandler;
  private toolSystem: ToolSystem;
  private sculptInteraction: SculptInteraction;
  private brushPreview: BrushPreview;
  private radialMenuL: RadialMenu;
  private radialMenuR: RadialMenu;
  private commandBus: CommandBus;
  private worldNavigation: WorldNavigation | null = null;
  private layerGrabSystem: LayerGrabSystem | null = null;
  private selectionManager: SelectionManager | null = null;
  private uiCallbacks: UICallbacks = {};

  // Panel system
  private panels: FloatingPanel[] = [];
  private panelGrabState: Map<string, FloatingPanel> = new Map(); // hand → grabbed panel
  private panelDragHand: string | null = null; // hand currently dragging a panel control

  constructor(
    controllers: XRControllerTracker | XREmulator,
    inputHandler: XRInputHandler,
    toolSystem: ToolSystem,
    sculptInteraction: SculptInteraction,
    brushPreview: BrushPreview,
    radialMenuL: RadialMenu,
    radialMenuR: RadialMenu,
    commandBus: CommandBus,
  ) {
    this.controllers = controllers;
    this.inputHandler = inputHandler;
    this.toolSystem = toolSystem;
    this.sculptInteraction = sculptInteraction;
    this.brushPreview = brushPreview;
    this.radialMenuL = radialMenuL;
    this.radialMenuR = radialMenuR;
    this.commandBus = commandBus;
  }

  setWorldNavigation(nav: WorldNavigation): void {
    this.worldNavigation = nav;
  }

  setLayerGrabSystem(lgs: LayerGrabSystem): void {
    this.layerGrabSystem = lgs;
  }

  setSelectionManager(sm: SelectionManager): void {
    this.selectionManager = sm;
  }

  setPanels(panels: FloatingPanel[]): void {
    this.panels = panels;
  }

  setUICallbacks(callbacks: UICallbacks): void {
    this.uiCallbacks = callbacks;
  }

  /** Transform a world-space controller position into worldGroup local space. */
  private toLocalPos(worldPos: Vec3): [number, number, number] {
    if (!this.worldNavigation) return [...worldPos] as [number, number, number];
    return this.worldNavigation.worldToLocal(worldPos) as [number, number, number];
  }

  /** Scale a scene-space radius to worldGroup local space (accounts for zoom). */
  private toLocalRadius(radius: number): number {
    if (!this.worldNavigation) return radius;
    return radius / this.worldNavigation.getScale();
  }

  /** Build a raycaster from position + direction (for select tool and panel interaction). */
  private buildRaycaster(position: Vec3, direction: Vec3): THREE.Raycaster {
    const raycaster = new THREE.Raycaster();
    raycaster.set(
      new THREE.Vector3(position[0], position[1], position[2]),
      new THREE.Vector3(direction[0], direction[1], direction[2]).normalize()
    );
    return raycaster;
  }

  update(): void {
    const actions = this.inputHandler.update();

    for (const action of actions) {
      this.routeAction(action);
    }

    // Update radial menus with current pointer positions
    if (this.radialMenuL.isOpen) {
      this.radialMenuL.updatePointer(this.controllers.left.position);
    }
    if (this.radialMenuR.isOpen) {
      this.radialMenuR.updatePointer(this.controllers.right.position);
    }

    // Update layer grab positions each frame
    if (this.layerGrabSystem) {
      for (const hand of ['left', 'right'] as const) {
        if (this.layerGrabSystem.isGrabbing(hand)) {
          const state = hand === 'left' ? this.controllers.left : this.controllers.right;
          this.layerGrabSystem.updateGrab(hand, this.toLocalPos(state.position), state.rotation);
        }
      }
    }

    // Update brush preview spheres
    this.brushPreview.update(this.controllers.left, this.controllers.right);
  }

  private routeAction(action: InputAction): void {
    switch (action.action) {
      // --- Trigger: use active tool ---
      case 'trigger_start': {
        const tool = this.toolSystem.getTool(action.hand);
        if (isSculptTool(tool)) {
          const strength = triggerStrength(action.value);
          this.sculptInteraction.beginStroke(
            action.hand,
            tool,
            this.toLocalPos(action.position),
            strength,
          );
        } else if (isSpawnTool(tool)) {
          this.handleSpawn(tool, this.toLocalPos(action.position));
        } else if (tool === 'move_layer') {
          this.layerGrabSystem?.tryGrab(action.hand, this.toLocalPos(action.position));
        } else if (isSelectTool(tool)) {
          this.handleSelectStart(action.hand, action.position, action.direction);
        } else if (tool === 'inspector') {
          this.uiCallbacks.toggleInspector?.(action.position);
        } else if (tool === 'hierarchy') {
          this.uiCallbacks.toggleHierarchy?.(action.position);
        }
        break;
      }

      case 'trigger_update': {
        const tool = this.toolSystem.getTool(action.hand);
        if (isSculptTool(tool)) {
          const strength = triggerStrength(action.value);
          const brushRadius = this.toLocalRadius(this.toolSystem.getBrushRadius(action.hand));
          this.sculptInteraction.updateStroke(
            action.hand,
            this.toLocalPos(action.position),
            strength,
            brushRadius,
          );
        } else if (isSelectTool(tool) && this.panelDragHand === action.hand) {
          // Forward ray to panel control drag
          if (action.direction) {
            const ray = this.buildRaycaster(action.position, action.direction);
            for (const panel of this.panels) {
              if (panel.isOpen && panel.isDraggingControl()) {
                panel.rayInteract(ray, 'update');
                break;
              }
            }
          }
        }
        // move_layer updateGrab is handled in update() loop
        break;
      }

      case 'trigger_end': {
        const tool = this.toolSystem.getTool(action.hand);
        if (isSculptTool(tool)) {
          this.sculptInteraction.endStroke(action.hand);
        } else if (tool === 'move_layer') {
          this.layerGrabSystem?.releaseGrab(action.hand);
        } else if (isSelectTool(tool) && this.panelDragHand === action.hand) {
          // End panel control drag
          for (const panel of this.panels) {
            if (panel.isOpen && panel.isDraggingControl()) {
              panel.rayInteract(new THREE.Raycaster(), 'end');
              break;
            }
          }
          this.panelDragHand = null;
        }
        break;
      }

      // --- Grip: panel grab intercept, then world navigation ---
      case 'grip_start': {
        // Check panel grab first
        let panelGrabbed = false;
        for (const panel of this.panels) {
          if (panel.tryGrab(action.position)) {
            this.panelGrabState.set(action.hand, panel);
            panelGrabbed = true;
            break;
          }
        }
        if (!panelGrabbed) {
          this.worldNavigation?.beginGrip(action.hand, action.position, action.rotation);
        }
        break;
      }
      case 'grip_update': {
        const grabbedPanel = this.panelGrabState.get(action.hand);
        if (grabbedPanel) {
          grabbedPanel.updateGrab(action.position);
        } else {
          this.worldNavigation?.updateGrip(action.hand, action.position, action.rotation);
        }
        break;
      }
      case 'grip_end': {
        const grabbedPanel = this.panelGrabState.get(action.hand);
        if (grabbedPanel) {
          grabbedPanel.releaseGrab();
          this.panelGrabState.delete(action.hand);
        } else {
          this.worldNavigation?.endGrip(action.hand);
        }
        break;
      }

      // --- Menu: radial menu hold/release ---
      case 'menu_hold': {
        const menu = action.hand === 'left' ? this.radialMenuL : this.radialMenuR;
        if (!menu.isOpen) {
          menu.open(action.position);
        }
        break;
      }
      case 'menu_release': {
        const menu = action.hand === 'left' ? this.radialMenuL : this.radialMenuR;
        if (menu.isOpen) {
          const selected = menu.close();
          if (selected) {
            this.toolSystem.setTool(action.hand, selected);
            console.log(`[Tool] ${action.hand}: ${selected}`);
          }
        }
        break;
      }

      // --- Thumbstick: brush radius ---
      case 'thumbstick': {
        if (Math.abs(action.y) > 0.2) {
          const delta = action.y * 0.0005;
          this.toolSystem.adjustBrushRadius(action.hand, delta);
        }
        break;
      }

      // --- Undo/redo ---
      case 'undo':
        this.commandBus.exec({ cmd: 'undo' });
        break;
      case 'redo':
        this.commandBus.exec({ cmd: 'redo' });
        break;
    }
  }

  /**
   * Handle select tool trigger start:
   * 1. Test open panels for ray interaction (sliders, pickers, etc.)
   * 2. If no panel hit, raycast into scene for object selection
   */
  private handleSelectStart(hand: 'left' | 'right', position: Vec3, direction: Vec3): void {
    const ray = this.buildRaycaster(position, direction);

    // Test open panels first
    for (const panel of this.panels) {
      if (panel.isOpen && panel.rayInteract(ray, 'start')) {
        if (panel.isDraggingControl()) {
          this.panelDragHand = hand;
        }
        return; // Panel consumed the ray
      }
    }

    // No panel hit — raycast into scene for selection
    if (this.selectionManager) {
      this.selectionManager.raySelect(position, direction);
    }
  }

  private handleSpawn(tool: string, position: Vec3): void {
    const typeMap: Record<string, string> = {
      spawn_cube: 'box',
      spawn_sphere: 'sphere',
      spawn_capsule: 'capsule',
    };
    const primitiveType = typeMap[tool];
    if (primitiveType) {
      const id = `${primitiveType}_${Date.now()}`;
      this.commandBus.exec({
        cmd: 'spawn',
        type: primitiveType,
        id,
        position: [...position],
      });
    } else if (tool === 'spawn_light') {
      const id = `light_${Date.now()}`;
      this.commandBus.exec({
        cmd: 'spawn_light',
        id,
        position: [...position],
      });
    }
  }
}
