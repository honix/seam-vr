// Central input dispatcher.
// Routes input actions to the appropriate subsystem based on per-hand tool selection.
// UI panels intercept rays BEFORE any tool — if a ray hits an open panel,
// the trigger is routed to the panel exclusively regardless of active tool.

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

// Per-hand state when trigger is interacting with a panel
interface PanelTriggerState {
  panel: FloatingPanel;
  mode: 'drag' | 'control' | 'block'; // drag=title bar, control=slider/picker, block=body hit
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
  private panelGrabState: Map<string, FloatingPanel> = new Map(); // hand → grip-grabbed panel
  private panelTriggerState: Map<string, PanelTriggerState> = new Map(); // hand → trigger panel interaction

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

  /** Build a raycaster from position + direction. */
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

  // -------------------------------------------------------
  // Panel intercept: test ALL trigger events against panels
  // BEFORE routing to any tool. Returns true if consumed.
  // -------------------------------------------------------

  /**
   * Test trigger_start against open panels.
   * If ray hits a panel, the trigger is routed to the panel exclusively.
   * Returns true if a panel consumed the event.
   */
  private tryPanelTriggerStart(hand: 'left' | 'right', position: Vec3, direction: Vec3): boolean {
    const ray = this.buildRaycaster(position, direction);

    for (const panel of this.panels) {
      if (!panel.isOpen) continue;

      // Test interactive controls first (sliders, pickers, dropdowns)
      if (panel.rayInteract(ray, 'start')) {
        const mode = panel.isDraggingControl() ? 'control' : 'block';
        this.panelTriggerState.set(hand, { panel, mode });
        return true;
      }

      // Then test panel surface (title bar vs body)
      const hit = panel.rayHitTest(ray);
      if (hit === 'title') {
        panel.beginRayGrab(ray);
        this.panelTriggerState.set(hand, { panel, mode: 'drag' });
        return true;
      }
      if (hit === 'body') {
        // Block the ray — panel body absorbs it
        this.panelTriggerState.set(hand, { panel, mode: 'block' });
        return true;
      }
    }

    return false;
  }

  /**
   * Forward trigger_update to the panel that captured the trigger.
   * Returns true if a panel is handling this hand.
   */
  private tryPanelTriggerUpdate(hand: string, position: Vec3, direction: Vec3): boolean {
    const state = this.panelTriggerState.get(hand);
    if (!state) return false;

    const ray = this.buildRaycaster(position, direction);

    switch (state.mode) {
      case 'drag':
        state.panel.updateRayGrab(ray);
        break;
      case 'control':
        state.panel.rayInteract(ray, 'update');
        break;
      case 'block':
        // Do nothing, just consume the event
        break;
    }
    return true;
  }

  /**
   * End panel trigger interaction.
   * Returns true if a panel was handling this hand.
   */
  private tryPanelTriggerEnd(hand: string): boolean {
    const state = this.panelTriggerState.get(hand);
    if (!state) return false;

    switch (state.mode) {
      case 'drag':
        state.panel.releaseGrab();
        break;
      case 'control':
        state.panel.rayInteract(new THREE.Raycaster(), 'end');
        break;
    }

    this.panelTriggerState.delete(hand);
    return true;
  }

  // -------------------------------------------------------

  private routeAction(action: InputAction): void {
    switch (action.action) {
      // --- Trigger: panels intercept first, then active tool ---
      case 'trigger_start': {
        // Panel intercept — any tool, if ray hits panel, panel gets exclusive input
        if (this.tryPanelTriggerStart(action.hand, action.position, action.direction)) {
          break; // Panel consumed
        }

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
          // No panel hit — raycast into scene for selection
          this.selectionManager?.raySelect(action.position, action.direction);
        } else if (tool === 'inspector') {
          this.uiCallbacks.toggleInspector?.(action.position);
        } else if (tool === 'hierarchy') {
          this.uiCallbacks.toggleHierarchy?.(action.position);
        }
        break;
      }

      case 'trigger_update': {
        // Panel intercept
        if (this.tryPanelTriggerUpdate(action.hand, action.position, action.direction)) {
          break; // Panel consumed
        }

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
        }
        // move_layer updateGrab is handled in update() loop
        break;
      }

      case 'trigger_end': {
        // Panel intercept
        if (this.tryPanelTriggerEnd(action.hand)) {
          break; // Panel consumed
        }

        const tool = this.toolSystem.getTool(action.hand);
        if (isSculptTool(tool)) {
          this.sculptInteraction.endStroke(action.hand);
        } else if (tool === 'move_layer') {
          this.layerGrabSystem?.releaseGrab(action.hand);
        }
        break;
      }

      // --- Grip: panel grab intercept, then world navigation ---
      case 'grip_start': {
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
