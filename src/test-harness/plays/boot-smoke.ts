import { DEFAULT_CLAY_FOCUS_TARGET } from '../harness';
import type { PlayScenario } from '../play-types';

export const bootSmokePlay: PlayScenario = {
  id: 'boot_smoke',
  description: 'Reset to the baseline clay scene, focus the camera, and capture a short idle sample.',
  tags: ['smoke', 'boot'],
  async run(ctx) {
    await ctx.reset();

    const scene = ctx.snapshotScene() as { nodes?: Array<{ id: string }> };
    if (!scene.nodes?.some((node) => node.id === 'clay_1')) {
      throw new Error('Baseline clay node was not restored by reset()');
    }

    ctx.focus(DEFAULT_CLAY_FOCUS_TARGET, 0.6);
    await ctx.waitFrames(5);
    ctx.captureViewport('boot_smoke');

    await ctx.measure('boot_idle', async () => {
      await ctx.waitFrames(30);
    });
  },
};
