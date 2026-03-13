import { DEFAULT_CLAY_FOCUS_TARGET } from '../harness';
import type { PlayScenario } from '../play-types';

const DEFAULT_ROTATION: [number, number, number, number] = [0, 0, 0, 1];

export const sculptStressShortPlay: PlayScenario = {
  id: 'sculpt_stress_short',
  description: 'Run a short deterministic sculpt stroke through the emulator and capture frame timings.',
  tags: ['sculpt', 'performance'],
  async run(ctx) {
    await ctx.reset();
    ctx.select('clay_1');
    ctx.activateClay('clay_1');
    ctx.setTool('right', 'sculpt_add');
    ctx.focus(DEFAULT_CLAY_FOCUS_TARGET, 0.5);
    await ctx.waitFrames(3);

    ctx.xr.pose('right', [0, 1.26, 0.18], DEFAULT_ROTATION);
    await ctx.waitFrames(2);
    ctx.xr.press('right', 'trigger');

    await ctx.measure('sculpt_drag', async () => {
      const points: Array<[number, number, number]> = [
        [0.01, 1.26, 0.16],
        [0.04, 1.26, 0.13],
        [0.07, 1.26, 0.1],
        [0.1, 1.26, 0.08],
        [0.09, 1.26, 0.05],
        [0.06, 1.26, 0.03],
        [0.03, 1.26, 0.02],
      ];

      for (const point of points) {
        ctx.xr.pose('right', point, DEFAULT_ROTATION);
        await ctx.waitFrames(2);
      }
    });

    ctx.xr.release('right', 'trigger');
    await ctx.waitFrames(10);
    ctx.setTool('right', 'select');
    ctx.captureViewport('sculpt_stress_short');
  },
};
