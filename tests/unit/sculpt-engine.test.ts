import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const { gpuInstances } = vi.hoisted(() => ({
  gpuInstances: [] as any[],
}));

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

vi.mock('../../src/sculpting/gpu-compute', () => ({
  GPUCompute: class MockGPUCompute {
    ready = true;
    applyBrushBatch = vi.fn(async () => {});
    applySmoothBatch = vi.fn(async () => {});
    syncBoundaryFaces = vi.fn(async (_chunks: unknown[]) => []);
    syncChunksToCPU = vi.fn(async () => {});
    buildPaddedAndExtractBatch = vi.fn(async (items: unknown[]) => items.map(() => ({ vertexCount: 0 })));
    invalidateChunk = vi.fn();
    releaseChunk = vi.fn();
    destroy = vi.fn();

    constructor() {
      gpuInstances.push(this);
    }

    async init(): Promise<boolean> {
      return true;
    }
  },
}));

import { SculptEngine } from '../../src/sculpting/sculpt-engine';

describe('SculptEngine', () => {
  it('clamps the effective brush radius to a local-space safety limit', () => {
    const engine = new SculptEngine(new THREE.Group());

    engine.brushRadius = 10;

    expect(engine.brushRadius).toBeCloseTo(0.108, 6);
    engine.dispose();
  });

  it('remeshes in smaller batches instead of one large result set', async () => {
    gpuInstances.length = 0;
    const engine = new SculptEngine(new THREE.Group());
    const gpu = gpuInstances[0];

    engine.brushRadius = 0.04;
    await engine.stroke([0, 0, 0], 'right');
    await engine.stroke([0, 0, 0], 'right');

    expect(gpu.applyBrushBatch).toHaveBeenCalledTimes(1);
    expect(gpu.syncBoundaryFaces).toHaveBeenCalledTimes(1);
    expect(gpu.buildPaddedAndExtractBatch.mock.calls.length).toBeGreaterThan(1);
    for (const [items] of gpu.buildPaddedAndExtractBatch.mock.calls) {
      expect((items as unknown[]).length).toBeLessThanOrEqual(6);
    }

    engine.dispose();
  });

  it('subdivides large fast moves instead of dropping the stroke segment', async () => {
    gpuInstances.length = 0;
    const engine = new SculptEngine(new THREE.Group());
    const gpu = gpuInstances[0];

    engine.brushRadius = 10;
    await engine.stroke([0, 0, 0], 'right');
    await engine.stroke([2, 0, 0], 'right');

    expect(gpu.applyBrushBatch.mock.calls.length).toBeGreaterThan(1);
    engine.dispose();
  });

  it('drains the last queued stroke segment after trigger release', async () => {
    gpuInstances.length = 0;
    const engine = new SculptEngine(new THREE.Group());
    const gpu = gpuInstances[0];
    const inFlightBrush = createDeferred<void>();

    gpu.applyBrushBatch
      .mockImplementationOnce(() => inFlightBrush.promise)
      .mockImplementation(async () => {});

    await engine.stroke([0, 0, 0], 'right');
    const activeStroke = engine.stroke([0.05, 0, 0], 'right');
    await Promise.resolve();
    await engine.stroke([0.1, 0, 0], 'right');
    engine.endStroke('right');

    inFlightBrush.resolve();
    await activeStroke;
    await Promise.resolve();
    await Promise.resolve();

    expect(gpu.applyBrushBatch).toHaveBeenCalledTimes(2);
    engine.dispose();
  });

  it('remeshes immediately during a short default-radius stroke', async () => {
    gpuInstances.length = 0;
    const engine = new SculptEngine(new THREE.Group());
    const gpu = gpuInstances[0];

    gpu.buildPaddedAndExtractBatch.mockImplementation(async (items: unknown[]) =>
      items.map(() => ({ vertexCount: 12, interleaved: new Float32Array(72) })),
    );

    await engine.stroke([0, 0, 0], 'right');
    await engine.stroke([0.01, 0, 0], 'right');

    expect(gpu.applyBrushBatch).toHaveBeenCalledTimes(1);
    expect(gpu.syncBoundaryFaces).toHaveBeenCalledTimes(1);
    expect(gpu.buildPaddedAndExtractBatch.mock.calls.length).toBeGreaterThan(0);
    expect(engine.getStats().vertices).toBeGreaterThan(0);
    engine.dispose();
  });

  it('only syncs chunk data back to CPU when explicitly requested', async () => {
    gpuInstances.length = 0;
    const engine = new SculptEngine(new THREE.Group());
    const gpu = gpuInstances[0];

    await engine.stroke([0, 0, 0], 'right');
    await engine.stroke([0.01, 0, 0], 'right');
    await engine.waitForIdle();
    expect(gpu.syncChunksToCPU).not.toHaveBeenCalled();

    await engine.waitForIdle({ syncCpu: true });
    expect(gpu.syncChunksToCPU).toHaveBeenCalledTimes(1);
    engine.dispose();
  });
});
