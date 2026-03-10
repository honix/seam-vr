import { describe, expect, it, vi } from 'vitest';
import { ToolSystem } from '../../src/interaction/tool-system';

describe('ToolSystem', () => {
  it('hides sculpt tools until a clay node is selected', () => {
    const toolSystem = new ToolSystem();
    expect(toolSystem.getAvailableTools().some((tool) => tool.id === 'sculpt_add')).toBe(false);

    toolSystem.setSelectedNodeType('clay');
    expect(toolSystem.getAvailableTools().some((tool) => tool.id === 'sculpt_add')).toBe(true);
  });

  it('falls back to select if a sculpt tool is chosen without clay selection', () => {
    const toolSystem = new ToolSystem();
    toolSystem.setTool('left', 'sculpt_add');
    expect(toolSystem.getTool('left')).toBe('select');
  });

  it('drops active sculpt tools back to select when clay selection is lost', () => {
    const toolSystem = new ToolSystem();
    const callback = vi.fn();
    toolSystem.onToolChange = callback;

    toolSystem.setSelectedNodeType('clay');
    toolSystem.setTool('left', 'sculpt_add');
    expect(toolSystem.getTool('left')).toBe('sculpt_add');

    toolSystem.setSelectedNodeType(null);
    expect(toolSystem.getTool('left')).toBe('select');
    expect(callback).toHaveBeenLastCalledWith('left', 'select');
  });

  it('clamps brush radius to a sane upper bound', () => {
    const toolSystem = new ToolSystem();

    toolSystem.adjustBrushRadius('left', 10);

    expect(toolSystem.getBrushRadius('left')).toBe(0.1);
  });
});
