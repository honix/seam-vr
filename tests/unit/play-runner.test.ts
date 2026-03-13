import { describe, expect, it, vi } from 'vitest';
import { PlayRunner, getPlayIdFromSearch, summarizeMeasurement } from '../../src/test-harness/play-runner';
import type { PlayFrameSample, PlayHarnessActions, PlayScenario } from '../../src/test-harness/play-types';

function createActions(overrides: Partial<PlayHarnessActions> = {}): PlayHarnessActions {
  return {
    exec: vi.fn(),
    select: vi.fn(),
    activateClay: vi.fn(),
    setTool: vi.fn(),
    panelState: vi.fn(() => ({ openPanels: [] })),
    xrPose: vi.fn(),
    xrButton: vi.fn(),
    xrThumbstick: vi.fn(),
    focus: vi.fn(),
    reset: vi.fn(async () => {}),
    snapshotScene: vi.fn(() => ({ nodes: [] })),
    captureViewport: vi.fn(() => 'data:image/png;base64,stub'),
    ...overrides,
  };
}

function sample(frameMs: number, renderMs: number, drawCalls: number): PlayFrameSample {
  return {
    frameMs,
    renderMs,
    drawCalls,
    triangles: drawCalls * 10,
    geometries: 4,
    textures: 2,
  };
}

describe('PlayRunner', () => {
  it('parses play ids from URL search strings', () => {
    expect(getPlayIdFromSearch('?play=boot_smoke')).toBe('boot_smoke');
    expect(getPlayIdFromSearch('?foo=bar')).toBeNull();
    expect(getPlayIdFromSearch('?play=')).toBeNull();
  });

  it('summarizes frame samples for a measurement window', () => {
    const result = summarizeMeasurement('idle', 42, [
      sample(10, 3, 100),
      sample(20, 5, 120),
    ]);

    expect(result.frameCount).toBe(2);
    expect(result.avgFrameMs).toBe(15);
    expect(result.minFrameMs).toBe(10);
    expect(result.maxRenderMs).toBe(5);
    expect(result.maxDrawCalls).toBe(120);
  });

  it('runs a scenario successfully and stores the last run', async () => {
    const actions = createActions();
    const scenario: PlayScenario = {
      id: 'ok',
      async run(ctx) {
        await ctx.reset();
        const pending = ctx.waitFrames(2);
        await ctx.measure('idle', async () => {
          await pending;
        });
        ctx.captureViewport('done');
      },
    };

    const runner = new PlayRunner({ scenarios: [scenario], actions });
    const runPromise = runner.run('ok');
    await Promise.resolve();
    runner.onFrame(sample(16, 5, 90));
    runner.onFrame(sample(18, 6, 95));

    const result = await runPromise;
    expect(result.status).toBe('passed');
    expect(result.measurements).toHaveLength(1);
    expect(result.captures).toHaveLength(1);
    expect(runner.getLastRun()?.id).toBe('ok');
    expect(actions.reset).toHaveBeenCalledTimes(1);
    expect(actions.activateClay).not.toHaveBeenCalled();
  });

  it('omits capture data URLs from the machine-readable console result', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const actions = createActions({
      captureViewport: vi.fn(() => 'data:image/png;base64,very-large-payload'),
    });
    const runner = new PlayRunner({
      scenarios: [{
        id: 'capture',
        async run(ctx) {
          ctx.captureViewport('after');
        },
      }],
      actions,
    });

    const result = await runner.run('capture');

    const playResultLog = consoleLog.mock.calls.find((call) => call[0] === '[PlayResult]');
    expect(result.captures[0]?.dataUrl).toContain('very-large-payload');
    expect(playResultLog?.[1]).toContain('"label":"after"');
    expect(playResultLog?.[1]).not.toContain('very-large-payload');
    consoleLog.mockRestore();
  });

  it('returns a failed result for unknown scenarios', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runner = new PlayRunner({ scenarios: [], actions: createActions() });

    const result = await runner.run('missing');

    expect(result.status).toBe('failed');
    expect(result.error?.message).toContain('Unknown play scenario');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('returns a failed result when a scenario throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runner = new PlayRunner({
      scenarios: [{
        id: 'broken',
        async run() {
          throw new Error('boom');
        },
      }],
      actions: createActions(),
    });

    const result = await runner.run('broken');

    expect(result.status).toBe('failed');
    expect(result.error?.message).toBe('boom');
    consoleError.mockRestore();
  });

  it('rejects concurrent play runs', async () => {
    let release!: () => void;
    const runner = new PlayRunner({
      scenarios: [{
        id: 'slow',
        run: async () => new Promise<void>((resolve) => {
          release = resolve;
        }),
      }],
      actions: createActions(),
    });

    const firstRun = runner.run('slow');
    await expect(runner.run('slow')).rejects.toThrow('already in progress');
    release();
    await firstRun;
  });
});
