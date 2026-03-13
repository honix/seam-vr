import { DEFAULT_CLAY_FOCUS_TARGET } from '../harness';
import type { PlayScenario } from '../play-types';

const DEFAULT_ROTATION: [number, number, number, number] = [0, 0, 0, 1];

async function assertClayVisible(ctx: Parameters<PlayScenario['run']>[0], message: string): Promise<void> {
  const clayStats = ctx.clayStats('clay_1') as {
    stats?: { vertices?: number };
  } | null;
  if ((clayStats?.stats?.vertices ?? 0) <= 0) {
    throw new Error(message);
  }
}

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

      await assertClayVisible(ctx, 'Clay mesh did not update before trigger release');
    });

    ctx.xr.release('right', 'trigger');
    await ctx.waitFrames(10);

    for (let step = 0; step < 12; step++) {
      ctx.xr.thumbstick('right', 0, 1);
      await ctx.waitFrames(1);
    }

    ctx.xr.pose('right', [0.02, 1.28, 0.2], DEFAULT_ROTATION);
    await ctx.waitFrames(2);
    ctx.xr.press('right', 'trigger');

    await ctx.measure('sculpt_drag_large_brush', async () => {
      const points: Array<[number, number, number]> = [
        [0.05, 1.28, 0.18],
        [0.08, 1.28, 0.15],
        [0.1, 1.28, 0.11],
        [0.07, 1.28, 0.07],
        [0.03, 1.28, 0.05],
      ];

      for (const point of points) {
        ctx.xr.pose('right', point, DEFAULT_ROTATION);
        await ctx.waitFrames(3);
      }

      await assertClayVisible(ctx, 'Clay mesh did not update during the large-brush stroke');
    });

    ctx.xr.release('right', 'trigger');
    await ctx.waitFrames(12);
    ctx.setTool('right', 'select');
    ctx.captureViewport('sculpt_stress_short');
  },
};
