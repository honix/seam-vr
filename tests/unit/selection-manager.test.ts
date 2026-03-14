import { describe, expect, it, vi } from 'vitest';
import { SelectionManager } from '../../src/interaction/selection-manager';

describe('SelectionManager', () => {
  it('treats synthetic root selection as a valid id with no concrete node', () => {
    const sceneGraph = {
      getNode: vi.fn(() => undefined),
    } as any;
    const worldGroup = {} as any;
    const manager = new SelectionManager(sceneGraph, worldGroup);
    const onChange = vi.fn();

    manager.onChange(onChange);
    manager.selectById('__root__');

    expect(manager.selectedNodeId).toBe('__root__');
    expect(sceneGraph.getNode).toHaveBeenCalledWith('__root__');
    expect(onChange).toHaveBeenCalledWith('__root__', null);
  });
});
