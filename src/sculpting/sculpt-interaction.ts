// Sculpt interaction handler for VR controllers.
// Per-hand sculpt state: each hand can independently sculpt on the selected clay node.

import type { BrushType } from './types';
import type { ToolId } from '../interaction/tool-system';
import { ClayManager } from './clay-manager';

type Hand = 'left' | 'right';

interface HandSculptState {
  isSculpting: boolean;
  brushType: BrushType;
}

const TOOL_TO_BRUSH: Partial<Record<ToolId, BrushType>> = {
  sculpt_add: 'add',
  sculpt_subtract: 'subtract',
  sculpt_smooth: 'smooth',
};

export class SculptInteraction {
  private clayManager: ClayManager;
  private handState: Map<Hand, HandSculptState> = new Map();

  constructor(clayManager: ClayManager) {
    this.clayManager = clayManager;
    this.handState.set('left', { isSculpting: false, brushType: 'add' });
    this.handState.set('right', { isSculpting: false, brushType: 'add' });
  }

  beginStroke(hand: Hand, toolId: ToolId, position: [number, number, number], strength: number): void {
    const brushType = TOOL_TO_BRUSH[toolId];
    const engine = this.clayManager.getActiveEngine();
    const localPosition = this.clayManager.toActiveClayLocalPosition(position);
    if (!brushType || !engine || !localPosition) return;

    const state = this.handState.get(hand)!;
    state.isSculpting = true;
    state.brushType = brushType;

    engine.beginStrokeSession(hand);
    engine.brushStrength = strength;
    if (brushType === 'smooth') {
      engine.smoothStroke(localPosition, hand);
    } else {
      engine.brushType = brushType;
      engine.stroke(localPosition, hand);
    }
  }

  updateStroke(hand: Hand, position: [number, number, number], strength: number, brushRadius: number): void {
    const state = this.handState.get(hand)!;
    if (!state.isSculpting) return;

    const engine = this.clayManager.getActiveEngine();
    const localPosition = this.clayManager.toActiveClayLocalPosition(position);
    if (!engine || !localPosition) return;

    engine.brushStrength = strength;
    engine.brushRadius = this.clayManager.toActiveClayLocalRadius(brushRadius);
    if (state.brushType === 'smooth') {
      engine.smoothStroke(localPosition, hand);
    } else {
      engine.brushType = state.brushType;
      engine.stroke(localPosition, hand);
    }
  }

  endStroke(hand: Hand): void {
    const state = this.handState.get(hand)!;
    if (!state.isSculpting) return;

    state.isSculpting = false;
    const engine = this.clayManager.getActiveEngine();
    engine?.endStroke(hand);
    engine?.endStrokeSession(hand);
  }
}
