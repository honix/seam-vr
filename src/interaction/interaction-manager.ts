import { XRControllerTracker } from '../xr/xr-controller';
import { XREmulator } from '../xr/xr-emulator';
import { XRInputHandler, InputAction } from '../xr/xr-input-handler';
import { ModeManager } from './mode-manager';
import { GrabSystem } from './grab-system';
import { HandleSystem } from './handle-system';
import { RadialPalette } from '../ui/radial-palette';
import { CommandBus } from '../core/command-bus';

export class InteractionManager {
  private controllers: XRControllerTracker | XREmulator;
  private inputHandler: XRInputHandler;
  private modeManager: ModeManager;
  private grabSystem: GrabSystem;
  private handleSystem: HandleSystem;
  private commandBus: CommandBus;
  private radialPalette: RadialPalette;

  private selectedNodeId: string | null = null;

  constructor(
    controllers: XRControllerTracker | XREmulator,
    inputHandler: XRInputHandler,
    modeManager: ModeManager,
    grabSystem: GrabSystem,
    handleSystem: HandleSystem,
    commandBus: CommandBus,
    radialPalette: RadialPalette
  ) {
    this.controllers = controllers;
    this.inputHandler = inputHandler;
    this.modeManager = modeManager;
    this.grabSystem = grabSystem;
    this.handleSystem = handleSystem;
    this.commandBus = commandBus;
    this.radialPalette = radialPalette;
  }

  update(): void {
    const actions = this.inputHandler.update();

    for (const action of actions) {
      this.handleAction(action);
    }

    // Update grab positions each frame for both hands
    for (const hand of ['left', 'right'] as const) {
      if (this.grabSystem.isGrabbing(hand)) {
        const state = hand === 'left' ? this.controllers.left : this.controllers.right;
        this.grabSystem.updateGrab(hand, state.position, state.rotation);
      }
    }

    // Keep handles following the selected object
    this.handleSystem.updatePosition();

    // Update handle drag if active
    if (this.handleSystem.isDragging) {
      // Use right controller position for handle dragging
      const state = this.controllers.right;
      this.handleSystem.updateHandleDrag(state.position);
    }

    // Update radial palette
    if (this.radialPalette.isOpen) {
      const state = this.controllers.right;
      const selected = this.radialPalette.update(
        state.position,
        state.trigger.pressed
      );
      if (selected) {
        // Palette selection handled internally (spawns primitive)
        this.radialPalette.close();
      }
    }
  }

  private handleAction(action: InputAction): void {
    const mode = this.modeManager.currentMode;

    switch (action.action) {
      case 'toggle_mode':
        this.modeManager.toggle();
        break;

      case 'undo':
        this.commandBus.exec({ cmd: 'undo' });
        break;

      case 'redo':
        this.commandBus.exec({ cmd: 'redo' });
        break;

      case 'open_palette':
        if (mode !== 'play') {
          if (this.radialPalette.isOpen) {
            this.radialPalette.close();
          } else {
            this.radialPalette.open(action.position);
          }
        }
        break;

      case 'grab_start':
        if (mode === 'play') break;

        if (mode === 'handle' && this.handleSystem.isActive) {
          // Try handles first
          const grabbedHandle = this.handleSystem.tryGrabHandle(
            action.position,
            action.direction
          );
          if (grabbedHandle) break;
        }

        // Try grabbing a primitive
        const grabbed = this.grabSystem.tryGrab(
          action.hand,
          action.position,
          action.direction
        );
        if (grabbed && mode === 'handle') {
          const nodeId = this.grabSystem.getGrabbedNodeId(action.hand);
          if (nodeId && nodeId !== this.selectedNodeId) {
            this.selectedNodeId = nodeId;
            this.handleSystem.showHandles(nodeId);
          }
        }
        break;

      case 'grab_end':
        if (mode === 'play') break;

        if (this.handleSystem.isDragging) {
          this.handleSystem.releaseHandle();
        } else {
          this.grabSystem.release(action.hand);
        }
        break;

      case 'trigger_press':
        // Trigger can be used for confirmation in palette or other UI
        break;

      case 'scale_start':
        // Two-handed scale will be handled by tracking distance between hands
        break;

      case 'scale_update':
        // Scale the selected primitive based on hand distance change
        break;

      case 'scale_end':
        break;
    }
  }

  getSelectedNodeId(): string | null {
    return this.selectedNodeId;
  }

  setSelectedNodeId(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    if (nodeId) {
      this.handleSystem.showHandles(nodeId);
    } else {
      this.handleSystem.hideHandles();
    }
  }
}
