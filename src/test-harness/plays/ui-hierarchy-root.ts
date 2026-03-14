import type { PlayScenario } from '../play-types';

function hasOpenPanel(panelState: object, kind: string): boolean {
  const state = panelState as { openPanels?: Array<{ kind: string; isOpen: boolean }> };
  return state.openPanels?.some((panel) => panel.kind === kind && panel.isOpen) ?? false;
}

export const uiHierarchyRootPlay: PlayScenario = {
  id: 'ui_hierarchy_root',
  description: 'Show a hierarchy with a selectable root row, top-level siblings, and a nested child.',
  tags: ['ui', 'hierarchy', 'smoke'],
  async run(ctx) {
    await ctx.reset();
    ctx.exec({ cmd: 'create_group', id: 'group_1', position: [0.18, 1.2, 0] });
    ctx.exec({
      cmd: 'spawn',
      id: 'box_child_1',
      type: 'box',
      position: [0, 0.12, 0],
      parentId: 'group_1',
    });
    ctx.select('__root__');
    ctx.focus([0.09, 1.2, 0], 1.15);
    await ctx.waitFrames(5);

    ctx.setTool('right', 'hierarchy');
    await ctx.waitFrames(6);
    if (!hasOpenPanel(ctx.panelState(), 'hierarchy')) {
      throw new Error('Hierarchy panel did not open for root hierarchy smoke');
    }

    const scene = ctx.snapshotScene() as { nodes?: Array<{ id: string; parent: string | null }> };
    const childNode = scene.nodes?.find((node) => node.id === 'box_child_1');
    if (!childNode || childNode.parent !== 'group_1') {
      throw new Error('Nested hierarchy test scene was not created as expected');
    }

    ctx.captureViewport('ui_hierarchy_root');
    await ctx.waitFrames(3);
    ctx.setTool('right', 'select');
    await ctx.waitFrames(3);
  },
};
