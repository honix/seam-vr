// Central input dispatcher.
// Routes input actions to the appropriate subsystem based on per-hand tool selection.
// No mode-based branching; tools determine behavior.

import { XRControllerTracker } from '../xr/xr-controller';
import { XREmulator } from '../xr/xr-emulator';
import { XRInputHandler, InputAction } from '../xr/xr-input-handler';
import { ToolSystem, isSculptTool, isSpawnTool } from './tool-system';
import { BrushPreview } from './brush-preview';
import { WorldNavigation } from './world-navigation';
import { LayerGrabSystem } from './layer-grab-system';
import { SculptInteraction } from '../sculpting/sculpt-interaction';
import { RadialMenu } from '../ui/radial-menu';
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
  private uiCallbacks: UICallbacks = {};

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

  setUICallbacks(callbacks: UICallbacks): void {
    this.uiCallbacks = callbacks;
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
          this.layerGrabSystem.updateGrab(hand, state.position, state.rotation);
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
            action.position as [number, number, number],
            strength,
          );
        } else if (isSpawnTool(tool)) {
          this.handleSpawn(tool, action.position);
        } else if (tool === 'move_layer') {
          this.layerGrabSystem?.tryGrab(action.hand, action.position);
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
          const brushRadius = this.toolSystem.getBrushRadius(action.hand);
          this.sculptInteraction.updateStroke(
            action.hand,
            action.position as [number, number, number],
            strength,
            brushRadius,
          );
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
        }
        break;
      }

      // --- Grip: world navigation ---
      case 'grip_start':
        this.worldNavigation?.beginGrip(action.hand, action.position, action.rotation);
        break;
      case 'grip_update':
        this.worldNavigation?.updateGrip(action.hand, action.position, action.rotation);
        break;
      case 'grip_end':
        this.worldNavigation?.endGrip(action.hand);
        break;

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
