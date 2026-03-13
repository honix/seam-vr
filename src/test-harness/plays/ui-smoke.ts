import type { PlayScenario } from '../play-types';

function hasOpenPanel(panelState: object, kind: string): boolean {
  const state = panelState as { openPanels?: Array<{ kind: string; isOpen: boolean }> };
  return state.openPanels?.some((panel) => panel.kind === kind && panel.isOpen) ?? false;
}

export const uiSmokePlay: PlayScenario = {
  id: 'ui_smoke',
  description: 'Open the main desktop panels through the tool flow and capture the viewport after each one.',
  tags: ['ui', 'smoke'],
  async run(ctx) {
    await ctx.reset();
    ctx.select('clay_1');
    ctx.focus([0, 1.2, 0], 0.85);
    await ctx.waitFrames(3);

    ctx.setTool('right', 'hierarchy');
    await ctx.waitFrames(5);
    if (!hasOpenPanel(ctx.panelState(), 'hierarchy')) {
      throw new Error('Hierarchy panel did not open');
    }
    ctx.captureViewport('ui_hierarchy');

    ctx.setTool('right', 'inspector');
    await ctx.waitFrames(5);
    if (!hasOpenPanel(ctx.panelState(), 'inspector')) {
      throw new Error('Inspector panel did not open');
    }
    ctx.captureViewport('ui_inspector');

    ctx.setTool('right', 'timeline');
    await ctx.waitFrames(5);
    if (!hasOpenPanel(ctx.panelState(), 'timeline')) {
      throw new Error('Timeline panel did not open');
    }
    ctx.captureViewport('ui_timeline');

    await ctx.measure('ui_idle', async () => {
      await ctx.waitFrames(20);
    });

    ctx.setTool('right', 'select');
    await ctx.waitFrames(3);
  },
};
