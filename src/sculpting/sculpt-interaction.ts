// Sculpt interaction handler for VR controllers.
// Per-hand sculpt state: each hand can independently sculpt with its own tool.
// Called by InteractionManager (not directly from the render loop).

import type { SculptEngine } from './sculpt-engine';
import type { BrushType } from './types';
import type { ToolId } from '../interaction/tool-system';

type Hand = 'left' | 'right';

interface HandSculptState {
  isSculpting: boolean;
  isMoving: boolean;
  brushType: BrushType;
}

const TOOL_TO_BRUSH: Partial<Record<ToolId, BrushType>> = {
  sculpt_add: 'add',
  sculpt_subtract: 'subtract',
  sculpt_smooth: 'smooth',
  sculpt_move: 'move',
};

export class SculptInteraction {
  private engine: SculptEngine;
  private handState: Map<Hand, HandSculptState> = new Map();

  constructor(engine: SculptEngine) {
    this.engine = engine;
    this.handState.set('left', { isSculpting: false, isMoving: false, brushType: 'add' });
    this.handState.set('right', { isSculpting: false, isMoving: false, brushType: 'add' });
  }

  /**
   * Begin a sculpt stroke for a hand.
   */
  beginStroke(hand: Hand, toolId: ToolId, position: [number, number, number], strength: number): void {
    const brushType = TOOL_TO_BRUSH[toolId];
    if (!brushType) return;

    const state = this.handState.get(hand)!;
    state.brushType = brushType;

    if (brushType === 'move') {
      if (!state.isMoving) {
        state.isMoving = true;
        this.engine.beginMove(position);
      }
    } else if (brushType === 'smooth') {
      state.isSculpting = true;
      state.brushType = brushType;
      this.engine.brushStrength = strength;
      this.engine.smoothStroke(position, hand);
    } else {
      state.isSculpting = true;
      this.engine.brushType = brushType;
      this.engine.brushStrength = strength;
      this.engine.stroke(position, hand);
    }
  }

  /**
   * Update an ongoing sculpt stroke for a hand.
   */
  updateStroke(hand: Hand, position: [number, number, number], strength: number, brushRadius: number): void {
    const state = this.handState.get(hand)!;

    if (state.isMoving) {
      this.engine.updateMove(position);
    } else if (state.isSculpting) {
      this.engine.brushStrength = strength;
      this.engine.brushRadius = brushRadius;
      if (state.brushType === 'smooth') {
        this.engine.smoothStroke(position, hand);
      } else {
        this.engine.brushType = state.brushType;
        this.engine.stroke(position, hand);
      }
    }
  }

  /**
   * End a sculpt stroke for a hand.
   */
  endStroke(hand: Hand): void {
    const state = this.handState.get(hand)!;

    if (state.isMoving) {
      state.isMoving = false;
      this.engine.endMove();
    } else if (state.isSculpting) {
      state.isSculpting = false;
      this.engine.endStroke(hand);
      this.engine.flushPendingRemesh();
    }
  }
}
