import { Vec3, Vec4, XRButtonState } from '../types';
import { XRControllerState } from './xr-controller';
import { Command } from '../core/command-bus';

const DEFAULT_BUTTON: XRButtonState = { pressed: false, touched: false, value: 0 };

function createDefaultState(): XRControllerState {
  return {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    trigger: { ...DEFAULT_BUTTON },
    grip: { ...DEFAULT_BUTTON },
    thumbstick: { x: 0, y: 0 },
    buttonA: { ...DEFAULT_BUTTON },
    buttonB: { ...DEFAULT_BUTTON },
    triggerJustPressed: false,
    triggerJustReleased: false,
    gripJustPressed: false,
    gripJustReleased: false,
    buttonAJustPressed: false,
    buttonAJustReleased: false,
    buttonBJustPressed: false,
    buttonBJustReleased: false,
  };
}

const BUTTON_MAP: Record<string, keyof Pick<XRControllerState, 'trigger' | 'grip' | 'buttonA' | 'buttonB'>> = {
  trigger: 'trigger',
  grip: 'grip',
  a: 'buttonA',
  x: 'buttonA',
  b: 'buttonB',
  y: 'buttonB',
};

export class XREmulator {
  leftController: XRControllerState;
  rightController: XRControllerState;
  active = true;

  private prevLeft: { trigger: boolean; grip: boolean; buttonA: boolean; buttonB: boolean };
  private prevRight: { trigger: boolean; grip: boolean; buttonA: boolean; buttonB: boolean };

  constructor() {
    this.leftController = createDefaultState();
    this.rightController = createDefaultState();
    this.prevLeft = { trigger: false, grip: false, buttonA: false, buttonB: false };
    this.prevRight = { trigger: false, grip: false, buttonA: false, buttonB: false };
  }

  handleCommand(cmd: Command): void {
    switch (cmd.cmd) {
      case 'xr_pose':
        this.handlePose(cmd);
        break;
      case 'xr_button':
        this.handleButton(cmd);
        break;
      case 'xr_grab_drag':
        this.handleGrabDrag(cmd);
        break;
      case 'xr_thumbstick':
        this.handleThumbstick(cmd);
        break;
    }
  }

  private handlePose(cmd: Command): void {
    const state = this.getState(cmd.hand);
    if (cmd.position) {
      state.position = [...cmd.position] as Vec3;
    }
    if (cmd.rotation) {
      state.rotation = [...cmd.rotation] as Vec4;
    }
  }

  private handleButton(cmd: Command): void {
    const state = this.getState(cmd.hand);
    const buttonKey = BUTTON_MAP[cmd.button];
    if (!buttonKey) return;

    const pressed = cmd.pressed ?? cmd.state === 'pressed';
    const button: XRButtonState = {
      pressed,
      touched: pressed,
      value: pressed ? 1 : 0,
    };
    (state[buttonKey] as XRButtonState) = button;

    // Compute edge detection immediately
    this.computeEdges(cmd.hand);
  }

  private handleGrabDrag(cmd: Command): void {
    // Convenience macro: set position to `from`, press grip, move to `to`, release
    const state = this.getState(cmd.hand);
    state.position = [...cmd.from] as Vec3;
    state.grip = { pressed: true, touched: true, value: 1 };
    this.computeEdges(cmd.hand);

    // After this, caller should update position in steps and then release
    // For synchronous use, we just set the final state
    state.position = [...cmd.to] as Vec3;
  }

  private handleThumbstick(cmd: Command): void {
    const state = this.getState(cmd.hand);
    state.thumbstick.x = cmd.x ?? 0;
    state.thumbstick.y = cmd.y ?? 0;
  }

  getState(hand: 'left' | 'right'): XRControllerState {
    return hand === 'left' ? this.leftController : this.rightController;
  }

  get left(): XRControllerState {
    return this.leftController;
  }

  get right(): XRControllerState {
    return this.rightController;
  }

  update(): void {
    this.computeEdges('left');
    this.computeEdges('right');
  }

  private computeEdges(hand: 'left' | 'right'): void {
    const state = hand === 'left' ? this.leftController : this.rightController;
    const prev = hand === 'left' ? this.prevLeft : this.prevRight;

    state.triggerJustPressed = state.trigger.pressed && !prev.trigger;
    state.triggerJustReleased = !state.trigger.pressed && prev.trigger;
    state.gripJustPressed = state.grip.pressed && !prev.grip;
    state.gripJustReleased = !state.grip.pressed && prev.grip;
    state.buttonAJustPressed = state.buttonA.pressed && !prev.buttonA;
    state.buttonAJustReleased = !state.buttonA.pressed && prev.buttonA;
    state.buttonBJustPressed = state.buttonB.pressed && !prev.buttonB;
    state.buttonBJustReleased = !state.buttonB.pressed && prev.buttonB;

    prev.trigger = state.trigger.pressed;
    prev.grip = state.grip.pressed;
    prev.buttonA = state.buttonA.pressed;
    prev.buttonB = state.buttonB.pressed;
  }
}
