// Sculpt interaction handler for VR controllers
// Routes controller input to SculptEngine brush operations.

import type { XRControllerState } from '../xr/xr-controller';
import type { SculptEngine } from './sculpt-engine';
import type { BrushType } from './types';

export class SculptInteraction {
  private engine: SculptEngine;
  private isSculpting: boolean = false;
  private isMoving: boolean = false;

  constructor(engine: SculptEngine) {
    this.engine = engine;
  }

  /**
   * Update sculpt interaction from controller state.
   * Called each frame when in sculpt mode.
   *
   * Controls:
   * - Trigger (right hand): Apply current brush (add/subtract)
   * - Grip (right hand): Move brush
   * - Button A: Cycle brush type
   * - Thumbstick Y: Adjust brush size
   */
  update(right: XRControllerState, left: XRControllerState): void {
    const pos: [number, number, number] = [...right.position];

    // Brush type cycling via button A
    if (right.buttonAJustPressed) {
      this.cycleBrushType();
    }

    // Brush size via left thumbstick Y
    if (Math.abs(left.thumbstick.y) > 0.2) {
      const delta = left.thumbstick.y * 0.0005;
      this.engine.brushRadius = this.engine.brushRadius + delta;
    }

    // Trigger: add/subtract sculpting — apply every frame for smooth strokes
    if (right.trigger.pressed && this.engine.brushType !== 'move') {
      this.isSculpting = true;
      this.engine.stroke(pos);
    } else if (this.isSculpting) {
      this.isSculpting = false;
    }

    // Grip: move brush
    if (right.grip.pressed) {
      if (!this.isMoving) {
        this.isMoving = true;
        this.engine.beginMove(pos);
      } else {
        this.engine.updateMove(pos);
      }
    } else if (this.isMoving) {
      this.isMoving = false;
      this.engine.endMove();
    }
  }

  private cycleBrushType(): void {
    const types: BrushType[] = ['add', 'subtract', 'move'];
    const idx = types.indexOf(this.engine.brushType);
    this.engine.brushType = types[(idx + 1) % types.length];
    console.log(`[Sculpt] Brush: ${this.engine.brushType}`);
  }
}
