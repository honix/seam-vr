import type { Hand } from '../types';
import { ToolId, WindowToolId, isWindowTool } from '../interaction/tool-system';

export type WindowTransition =
  | { kind: 'noop' }
  | { kind: 'open'; hand: Hand; next: WindowToolId }
  | { kind: 'replace'; hand: Hand; previous: WindowToolId; next: WindowToolId }
  | { kind: 'close'; hand: Hand; previous: WindowToolId };

export class WindowToolController {
  private left: WindowToolId | null = null;
  private right: WindowToolId | null = null;

  applyTool(hand: Hand, tool: ToolId): WindowTransition {
    const current = this.get(hand);

    if (isWindowTool(tool)) {
      if (current === tool) {
        return { kind: 'noop' };
      }
      this.set(hand, tool);
      if (current) {
        return { kind: 'replace', hand, previous: current, next: tool };
      }
      return { kind: 'open', hand, next: tool };
    }

    if (!current) {
      return { kind: 'noop' };
    }

    this.set(hand, null);
    return { kind: 'close', hand, previous: current };
  }

  get(hand: Hand): WindowToolId | null {
    return hand === 'left' ? this.left : this.right;
  }

  private set(hand: Hand, tool: WindowToolId | null): void {
    if (hand === 'left') {
      this.left = tool;
    } else {
      this.right = tool;
    }
  }
}
