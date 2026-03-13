import { describe, expect, it } from 'vitest';
import { WindowToolController } from '../../src/ui/window-tool-controller';

describe('WindowToolController', () => {
  it('opens a live window when a window tool is selected', () => {
    const controller = new WindowToolController();
    expect(controller.applyTool('left', 'inspector')).toEqual({
      kind: 'open',
      hand: 'left',
      next: 'inspector',
    });
  });

  it('treats selecting the same window tool again as a no-op', () => {
    const controller = new WindowToolController();
    controller.applyTool('left', 'hierarchy');
    expect(controller.applyTool('left', 'hierarchy')).toEqual({ kind: 'noop' });
  });

  it('replaces the current live window on the same hand', () => {
    const controller = new WindowToolController();
    controller.applyTool('right', 'inspector');
    expect(controller.applyTool('right', 'timeline')).toEqual({
      kind: 'replace',
      hand: 'right',
      previous: 'inspector',
      next: 'timeline',
    });
  });

  it('closes the live window when a non-window tool is selected on that hand', () => {
    const controller = new WindowToolController();
    controller.applyTool('right', 'timeline');
    expect(controller.applyTool('right', 'select')).toEqual({
      kind: 'close',
      hand: 'right',
      previous: 'timeline',
    });
  });

  it('tracks hands independently', () => {
    const controller = new WindowToolController();
    controller.applyTool('left', 'inspector');
    expect(controller.applyTool('right', 'hierarchy')).toEqual({
      kind: 'open',
      hand: 'right',
      next: 'hierarchy',
    });
  });
});
