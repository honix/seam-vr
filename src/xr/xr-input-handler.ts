import { Vec3 } from '../types';
import { XRControllerState, XRControllerTracker } from './xr-controller';
import { XREmulator } from './xr-emulator';

export type InputAction =
  | { action: 'grab_start'; hand: 'left' | 'right'; position: Vec3; direction: Vec3 }
  | { action: 'grab_end'; hand: 'left' | 'right'; position: Vec3 }
  | { action: 'trigger_press'; hand: 'left' | 'right'; position: Vec3 }
  | { action: 'toggle_mode' }
  | { action: 'open_palette'; hand: 'left' | 'right'; position: Vec3 }
  | { action: 'undo' }
  | { action: 'redo' }
  | { action: 'scale_start'; leftPos: Vec3; rightPos: Vec3 }
  | { action: 'scale_update'; leftPos: Vec3; rightPos: Vec3 }
  | { action: 'scale_end' };

interface ControllerSource {
  left: XRControllerState;
  right: XRControllerState;
}

export class XRInputHandler {
  private controllers: ControllerSource;
  private isScaling = false;
  private undoThrottled = false;
  private redoThrottled = false;

  constructor(controllers: XRControllerTracker | XREmulator) {
    this.controllers = controllers;
  }

  update(): InputAction[] {
    const actions: InputAction[] = [];
    const left = this.controllers.left;
    const right = this.controllers.right;

    // Two-handed scale: both grips held
    if (left.grip.pressed && right.grip.pressed) {
      if (!this.isScaling) {
        this.isScaling = true;
        actions.push({
          action: 'scale_start',
          leftPos: [...left.position] as Vec3,
          rightPos: [...right.position] as Vec3,
        });
      } else {
        actions.push({
          action: 'scale_update',
          leftPos: [...left.position] as Vec3,
          rightPos: [...right.position] as Vec3,
        });
      }
    } else if (this.isScaling) {
      this.isScaling = false;
      actions.push({ action: 'scale_end' });
    }

    // Skip individual grip/trigger if scaling
    if (!this.isScaling) {
      // Process each hand
      for (const hand of ['left', 'right'] as const) {
        const state = hand === 'left' ? left : right;
        this.processHand(hand, state, actions);
      }
    }

    // Thumbstick undo/redo (left controller)
    this.processUndoRedo(left, actions);

    return actions;
  }

  private processHand(
    hand: 'left' | 'right',
    state: XRControllerState,
    actions: InputAction[]
  ): void {
    // Grip press = grab start
    if (state.gripJustPressed) {
      actions.push({
        action: 'grab_start',
        hand,
        position: [...state.position] as Vec3,
        direction: this.getForwardDirection(state),
      });
    }

    // Grip release = grab end
    if (state.gripJustReleased) {
      actions.push({
        action: 'grab_end',
        hand,
        position: [...state.position] as Vec3,
      });
    }

    // Trigger press = confirm / interact
    if (state.triggerJustPressed) {
      actions.push({
        action: 'trigger_press',
        hand,
        position: [...state.position] as Vec3,
      });
    }

    // A/X button = toggle mode
    if (state.buttonAJustPressed) {
      actions.push({ action: 'toggle_mode' });
    }

    // B/Y button = open palette
    if (state.buttonBJustPressed) {
      actions.push({
        action: 'open_palette',
        hand,
        position: [...state.position] as Vec3,
      });
    }
  }

  private processUndoRedo(left: XRControllerState, actions: InputAction[]): void {
    // Thumbstick left = undo (with throttle)
    if (left.thumbstick.x < -0.5) {
      if (!this.undoThrottled) {
        actions.push({ action: 'undo' });
        this.undoThrottled = true;
      }
    } else {
      this.undoThrottled = false;
    }

    // Thumbstick right = redo (with throttle)
    if (left.thumbstick.x > 0.5) {
      if (!this.redoThrottled) {
        actions.push({ action: 'redo' });
        this.redoThrottled = true;
      }
    } else {
      this.redoThrottled = false;
    }
  }

  private getForwardDirection(state: XRControllerState): Vec3 {
    // Compute forward (-Z) direction from quaternion
    const [qx, qy, qz, qw] = state.rotation;
    // Forward = rotate (0, 0, -1) by quaternion
    const x = 2 * (qx * qz + qw * qy);
    const y = 2 * (qy * qz - qw * qx);
    const z = -(1 - 2 * (qx * qx + qy * qy));
    return [x, y, z];
  }
}
