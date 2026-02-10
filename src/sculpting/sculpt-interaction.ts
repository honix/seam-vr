// Sculpt interaction handler for VR controllers
// Routes controller input to SculptEngine brush operations.

import type { XRControllerState } from '../xr/xr-controller';
import type { SculptEngine } from './sculpt-engine';
import type { BrushType } from './types';

export class SculptInteraction {
  private engine: SculptEngine;
  private isSculpting: boolean = false;
  private isMoving: boolean = false;

  // Track last stroke position to avoid redundant strokes at same position
  private lastStrokePos: [number, number, number] | null = null;
  private minStrokeDistance: number; // minimum distance between strokes

  constructor(engine: SculptEngine) {
    this.engine = engine;
    // Stroke at minimum every half brush radius
    this.minStrokeDistance = engine.brushRadius * 0.5;
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
      this.minStrokeDistance = this.engine.brushRadius * 0.5;
    }

    // Trigger: add/subtract sculpting
    if (right.trigger.pressed && this.engine.brushType !== 'move') {
      if (!this.isSculpting) {
        // Start new stroke
        this.isSculpting = true;
        this.lastStrokePos = null;
      }

      // Only stroke if moved enough distance
      if (this.shouldStroke(pos)) {
        this.engine.stroke(pos);
        this.lastStrokePos = pos;
      }
    } else if (this.isSculpting) {
      this.isSculpting = false;
      this.lastStrokePos = null;
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

  private shouldStroke(pos: [number, number, number]): boolean {
    if (!this.lastStrokePos) return true;
    const dx = pos[0] - this.lastStrokePos[0];
    const dy = pos[1] - this.lastStrokePos[1];
    const dz = pos[2] - this.lastStrokePos[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz) >= this.minStrokeDistance;
  }

  private cycleBrushType(): void {
    const types: BrushType[] = ['add', 'subtract', 'move'];
    const idx = types.indexOf(this.engine.brushType);
    this.engine.brushType = types[(idx + 1) % types.length];
    console.log(`[Sculpt] Brush: ${this.engine.brushType}`);
  }
}
