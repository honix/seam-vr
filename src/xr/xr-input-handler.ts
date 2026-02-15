// XR input handler - translates controller state into InputAction events.
// New mapping: trigger=tool use, grip=world nav, Y/B=radial menu, stick=brush radius+undo/redo.

import { Vec3 } from '../types';
import { XRControllerState, XRControllerTracker } from './xr-controller';
import { XREmulator } from './xr-emulator';

export type InputAction =
  // Trigger
  | { action: 'trigger_start'; hand: 'left' | 'right'; position: Vec3; direction: Vec3; value: number }
  | { action: 'trigger_update'; hand: 'left' | 'right'; position: Vec3; direction: Vec3; value: number }
  | { action: 'trigger_end'; hand: 'left' | 'right'; position: Vec3; direction: Vec3 }
  // Grip (world navigation)
  | { action: 'grip_start'; hand: 'left' | 'right'; position: Vec3; rotation: [number, number, number, number] }
  | { action: 'grip_update'; hand: 'left' | 'right'; position: Vec3; rotation: [number, number, number, number] }
  | { action: 'grip_end'; hand: 'left' | 'right'; position: Vec3 }
  // Menu (Y/B hold-release)
  | { action: 'menu_hold'; hand: 'left' | 'right'; position: Vec3 }
  | { action: 'menu_release'; hand: 'left' | 'right'; position: Vec3 }
  // Thumbstick
  | { action: 'thumbstick'; hand: 'left' | 'right'; x: number; y: number }
  // Undo/redo
  | { action: 'undo' }
  | { action: 'redo' };

interface ControllerSource {
  left: XRControllerState;
  right: XRControllerState;
}

export class XRInputHandler {
  private controllers: ControllerSource;
  private undoThrottled = false;
  private redoThrottled = false;

  constructor(controllers: XRControllerTracker | XREmulator) {
    this.controllers = controllers;
  }

  update(): InputAction[] {
    const actions: InputAction[] = [];
    const left = this.controllers.left;
    const right = this.controllers.right;

    // Process each hand
    for (const hand of ['left', 'right'] as const) {
      const state = hand === 'left' ? left : right;
      this.processHand(hand, state, actions);
    }

    // Thumbstick undo/redo (left controller, X axis)
    this.processUndoRedo(left, actions);

    return actions;
  }

  private processHand(
    hand: 'left' | 'right',
    state: XRControllerState,
    actions: InputAction[]
  ): void {
    // --- Trigger: tool use with analog value ---
    if (state.triggerJustPressed) {
      actions.push({
        action: 'trigger_start',
        hand,
        position: [...state.position] as Vec3,
        direction: this.getForwardDirection(state),
        value: state.trigger.value,
      });
    } else if (state.trigger.pressed) {
      actions.push({
        action: 'trigger_update',
        hand,
        position: [...state.position] as Vec3,
        direction: this.getForwardDirection(state),
        value: state.trigger.value,
      });
    } else if (state.triggerJustReleased) {
      actions.push({
        action: 'trigger_end',
        hand,
        position: [...state.position] as Vec3,
        direction: this.getForwardDirection(state),
      });
    }

    // --- Grip: world navigation ---
    if (state.gripJustPressed) {
      actions.push({
        action: 'grip_start',
        hand,
        position: [...state.position] as Vec3,
        rotation: [...state.rotation] as [number, number, number, number],
      });
    } else if (state.grip.pressed) {
      actions.push({
        action: 'grip_update',
        hand,
        position: [...state.position] as Vec3,
        rotation: [...state.rotation] as [number, number, number, number],
      });
    } else if (state.gripJustReleased) {
      actions.push({
        action: 'grip_end',
        hand,
        position: [...state.position] as Vec3,
      });
    }

    // --- B/Y button: radial menu hold/release ---
    // Y = left hand's B button, B = right hand's B button
    if (state.buttonBJustPressed) {
      actions.push({
        action: 'menu_hold',
        hand,
        position: [...state.position] as Vec3,
      });
    }
    if (state.buttonBJustReleased) {
      actions.push({
        action: 'menu_release',
        hand,
        position: [...state.position] as Vec3,
      });
    }

    // --- Thumbstick: brush radius (Y axis) per hand ---
    if (Math.abs(state.thumbstick.y) > 0.2 || Math.abs(state.thumbstick.x) > 0.2) {
      actions.push({
        action: 'thumbstick',
        hand,
        x: state.thumbstick.x,
        y: state.thumbstick.y,
      });
    }
  }

  private processUndoRedo(left: XRControllerState, actions: InputAction[]): void {
    // Left thumbstick X = undo/redo (with throttle)
    if (left.thumbstick.x < -0.5) {
      if (!this.undoThrottled) {
        actions.push({ action: 'undo' });
        this.undoThrottled = true;
      }
    } else {
      this.undoThrottled = false;
    }

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
    const [qx, qy, qz, qw] = state.rotation;
    // Rotate (0,0,-1) by quaternion: negate entire Z-column of rotation matrix
    const x = -2 * (qx * qz + qw * qy);
    const y = -2 * (qy * qz - qw * qx);
    const z = -(1 - 2 * (qx * qx + qy * qy));
    return [x, y, z];
  }
}
