import * as THREE from 'three';
import { Vec3, Vec4, XRButtonState } from '../types';

export interface XRControllerState {
  position: Vec3;
  rotation: Vec4;
  trigger: XRButtonState;
  grip: XRButtonState;
  thumbstick: { x: number; y: number };
  buttonA: XRButtonState;
  buttonB: XRButtonState;

  // Edge detection
  triggerJustPressed: boolean;
  triggerJustReleased: boolean;
  gripJustPressed: boolean;
  gripJustReleased: boolean;
  buttonAJustPressed: boolean;
  buttonAJustReleased: boolean;
  buttonBJustPressed: boolean;
  buttonBJustReleased: boolean;
}

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

export class XRControllerTracker {
  left: XRControllerState;
  right: XRControllerState;

  private renderer: THREE.WebGLRenderer;
  private controllerL: THREE.Group;
  private controllerR: THREE.Group;
  private gripL: THREE.Group;
  private gripR: THREE.Group;

  private prevTriggerL = false;
  private prevTriggerR = false;
  private prevGripL = false;
  private prevGripR = false;
  private prevButtonAL = false;
  private prevButtonAR = false;
  private prevButtonBL = false;
  private prevButtonBR = false;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.left = createDefaultState();
    this.right = createDefaultState();

    this.controllerL = renderer.xr.getController(0);
    this.controllerR = renderer.xr.getController(1);
    this.gripL = renderer.xr.getControllerGrip(0);
    this.gripR = renderer.xr.getControllerGrip(1);
  }

  setupControllers(scene: THREE.Scene): void {
    // Ray visual for each controller
    const rayGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -50),
    ]);

    const rayMaterialL = new THREE.LineBasicMaterial({ color: 0x4488ff });
    const rayMaterialR = new THREE.LineBasicMaterial({ color: 0xff4488 });

    this.controllerL.add(new THREE.Line(rayGeometry.clone(), rayMaterialL));
    this.controllerR.add(new THREE.Line(rayGeometry.clone(), rayMaterialR));

    // Simple hand visual (small sphere at grip)
    const handGeo = new THREE.SphereGeometry(0.02, 8, 8);
    const handMatL = new THREE.MeshBasicMaterial({ color: 0x4488ff });
    const handMatR = new THREE.MeshBasicMaterial({ color: 0xff4488 });

    this.gripL.add(new THREE.Mesh(handGeo.clone(), handMatL));
    this.gripR.add(new THREE.Mesh(handGeo.clone(), handMatR));

    scene.add(this.controllerL);
    scene.add(this.controllerR);
    scene.add(this.gripL);
    scene.add(this.gripR);

    // Debug: log when controllers connect/disconnect
    this.controllerL.addEventListener('connected', (event: any) => {
      console.log('[XR] Controller 0 connected:', event.data?.handedness, event.data?.profiles);
    });
    this.controllerR.addEventListener('connected', (event: any) => {
      console.log('[XR] Controller 1 connected:', event.data?.handedness, event.data?.profiles);
    });
    this.controllerL.addEventListener('disconnected', () => {
      console.log('[XR] Controller 0 disconnected');
    });
    this.controllerR.addEventListener('disconnected', () => {
      console.log('[XR] Controller 1 disconnected');
    });
  }

  update(): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;

    for (const source of session.inputSources) {
      const hand = source.handedness;
      if (hand !== 'left' && hand !== 'right') continue;

      const state = hand === 'left' ? this.left : this.right;
      const controller = hand === 'left' ? this.controllerL : this.controllerR;

      // Position and rotation from the Three.js controller object
      const pos = controller.position;
      state.position = [pos.x, pos.y, pos.z];

      const quat = controller.quaternion;
      state.rotation = [quat.x, quat.y, quat.z, quat.w];

      // Gamepad button state
      const gp = source.gamepad;
      if (gp) {
        if (gp.buttons[0]) {
          state.trigger = {
            pressed: gp.buttons[0].pressed,
            touched: gp.buttons[0].touched,
            value: gp.buttons[0].value,
          };
        }
        if (gp.buttons[1]) {
          state.grip = {
            pressed: gp.buttons[1].pressed,
            touched: gp.buttons[1].touched,
            value: gp.buttons[1].value,
          };
        }
        if (gp.buttons[4]) {
          state.buttonA = {
            pressed: gp.buttons[4].pressed,
            touched: gp.buttons[4].touched,
            value: gp.buttons[4].value,
          };
        }
        if (gp.buttons[5]) {
          state.buttonB = {
            pressed: gp.buttons[5].pressed,
            touched: gp.buttons[5].touched,
            value: gp.buttons[5].value,
          };
        }

        // Thumbstick
        state.thumbstick.x = gp.axes[2] ?? 0;
        state.thumbstick.y = gp.axes[3] ?? 0;
      }
    }

    // Edge detection
    this.computeEdges('left');
    this.computeEdges('right');
  }

  private computeEdges(hand: 'left' | 'right'): void {
    const state = hand === 'left' ? this.left : this.right;

    if (hand === 'left') {
      state.triggerJustPressed = state.trigger.pressed && !this.prevTriggerL;
      state.triggerJustReleased = !state.trigger.pressed && this.prevTriggerL;
      state.gripJustPressed = state.grip.pressed && !this.prevGripL;
      state.gripJustReleased = !state.grip.pressed && this.prevGripL;
      state.buttonAJustPressed = state.buttonA.pressed && !this.prevButtonAL;
      state.buttonAJustReleased = !state.buttonA.pressed && this.prevButtonAL;
      state.buttonBJustPressed = state.buttonB.pressed && !this.prevButtonBL;
      state.buttonBJustReleased = !state.buttonB.pressed && this.prevButtonBL;

      this.prevTriggerL = state.trigger.pressed;
      this.prevGripL = state.grip.pressed;
      this.prevButtonAL = state.buttonA.pressed;
      this.prevButtonBL = state.buttonB.pressed;
    } else {
      state.triggerJustPressed = state.trigger.pressed && !this.prevTriggerR;
      state.triggerJustReleased = !state.trigger.pressed && this.prevTriggerR;
      state.gripJustPressed = state.grip.pressed && !this.prevGripR;
      state.gripJustReleased = !state.grip.pressed && this.prevGripR;
      state.buttonAJustPressed = state.buttonA.pressed && !this.prevButtonAR;
      state.buttonAJustReleased = !state.buttonA.pressed && this.prevButtonAR;
      state.buttonBJustPressed = state.buttonB.pressed && !this.prevButtonBR;
      state.buttonBJustReleased = !state.buttonB.pressed && this.prevButtonBR;

      this.prevTriggerR = state.trigger.pressed;
      this.prevGripR = state.grip.pressed;
      this.prevButtonAR = state.buttonA.pressed;
      this.prevButtonBR = state.buttonB.pressed;
    }
  }

  getController(hand: 'left' | 'right'): THREE.Group {
    return hand === 'left' ? this.controllerL : this.controllerR;
  }

  getControllerGrip(hand: 'left' | 'right'): THREE.Group {
    return hand === 'left' ? this.gripL : this.gripR;
  }
}
