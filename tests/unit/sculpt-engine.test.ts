import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const { gpuInstances } = vi.hoisted(() => ({
  gpuInstances: [] as any[],
}));

vi.mock('../../src/sculpting/gpu-compute', () => ({
  GPUCompute: class MockGPUCompute {
    ready = true;
    applyBrushBatch = vi.fn(async () => {});
    applySmoothBatch = vi.fn(async () => {});
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

    expect(engine.brushRadius).toBeCloseTo(0.096, 6);
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
});
