import { describe, it, expect } from 'vitest';
import { Chunk } from '../../src/sculpting/chunk';
import { SDFVolume } from '../../src/sculpting/sdf-volume';
import { EDGE_TABLE, TRI_TABLE } from '../../src/sculpting/marching-tables';
import type { SculptConfig } from '../../src/sculpting/types';
import { chunkKey, parseChunkKey } from '../../src/sculpting/types';

const TEST_CONFIG: SculptConfig = {
  chunkSize: 8,
  voxelSize: 0.01,
  emptyValue: 1.0,
};

function buildPaddedCpu(
  center: Chunk,
  neighbors: {
    nxm?: Chunk;
    nxp?: Chunk;
    nym?: Chunk;
    nyp?: Chunk;
    nzm?: Chunk;
    nzp?: Chunk;
  },
  config: SculptConfig
): Float32Array {
  const s = center.samples;
  const p = s + 2;
  const cs = s - 1;
  const padded = new Float32Array(p * p * p);

  for (let pz = 0; pz < p; pz++) {
    for (let py = 0; py < p; py++) {
      for (let px = 0; px < p; px++) {
        const outIdx = pz * p * p + py * p + px;
        const onXm = px === 0;
        const onXp = px === p - 1;
        const onYm = py === 0;
        const onYp = py === p - 1;
        const onZm = pz === 0;
        const onZp = pz === p - 1;
        const boundaryCount =
          Number(onXm) + Number(onXp) +
          Number(onYm) + Number(onYp) +
          Number(onZm) + Number(onZp);

        if (boundaryCount === 0) {
          padded[outIdx] = center.get(px - 1, py - 1, pz - 1);
          continue;
        }

        if (boundaryCount > 1) {
          padded[outIdx] = config.emptyValue;
          continue;
        }

        const ix = px - 1;
        const iy = py - 1;
        const iz = pz - 1;

        if (onXm) {
          padded[outIdx] = neighbors.nxm?.get(cs - 1, iy, iz) ?? config.emptyValue;
        } else if (onXp) {
          padded[outIdx] = neighbors.nxp?.get(1, iy, iz) ?? config.emptyValue;
        } else if (onYm) {
          padded[outIdx] = neighbors.nym?.get(ix, cs - 1, iz) ?? config.emptyValue;
        } else if (onYp) {
          padded[outIdx] = neighbors.nyp?.get(ix, 1, iz) ?? config.emptyValue;
        } else if (onZm) {
          padded[outIdx] = neighbors.nzm?.get(ix, iy, cs - 1) ?? config.emptyValue;
        } else {
          padded[outIdx] = neighbors.nzp?.get(ix, iy, 1) ?? config.emptyValue;
        }
      }
    }
  }

  return padded;
}

function laplacianFromPadded(
  padded: Float32Array,
  samples: number,
  ix: number,
  iy: number,
  iz: number
): number {
  const p = samples + 2;
  const px = ix + 1;
  const py = iy + 1;
  const pz = iz + 1;
  const idx = pz * p * p + py * p + px;
  const neighborAvg = (
    padded[pz * p * p + py * p + (px - 1)] +
    padded[pz * p * p + py * p + (px + 1)] +
    padded[pz * p * p + (py - 1) * p + px] +
    padded[pz * p * p + (py + 1) * p + px] +
    padded[(pz - 1) * p * p + py * p + px] +
    padded[(pz + 1) * p * p + py * p + px]
  ) / 6;

  return neighborAvg;
}

function laplacianWithLocalClamp(chunk: Chunk, ix: number, iy: number, iz: number): number {
  const s = chunk.samples;
  const clamp = (value: number) => Math.max(0, Math.min(s - 1, value));
  return (
    chunk.get(clamp(ix - 1), iy, iz) +
    chunk.get(clamp(ix + 1), iy, iz) +
    chunk.get(ix, clamp(iy - 1), iz) +
    chunk.get(ix, clamp(iy + 1), iz) +
    chunk.get(ix, iy, clamp(iz - 1)) +
    chunk.get(ix, iy, clamp(iz + 1))
  ) / 6;
}

function seedSharedXSeam(left: Chunk, right: Chunk): void {
  const cs = left.samples - 1;
  const seamY = 4;
  const seamZ = 5;

  left.set(cs, seamY, seamZ, 0.4);
  right.set(0, seamY, seamZ, 0.4);

  left.set(cs - 1, seamY, seamZ, -0.6);
  right.set(1, seamY, seamZ, 0.2);

  left.set(cs, seamY - 1, seamZ, -0.4);
  right.set(0, seamY - 1, seamZ, -0.4);

  left.set(cs, seamY + 1, seamZ, 0.3);
  right.set(0, seamY + 1, seamZ, 0.3);

  left.set(cs, seamY, seamZ - 1, -0.1);
  right.set(0, seamY, seamZ - 1, -0.1);

  left.set(cs, seamY, seamZ + 1, 0.5);
  right.set(0, seamY, seamZ + 1, 0.5);
}

describe('Sculpting System', () => {
  describe('Chunk', () => {
    it('initializes with empty SDF values', () => {
      const chunk = new Chunk({ x: 0, y: 0, z: 0 }, TEST_CONFIG);
      expect(chunk.samples).toBe(9);
      expect(chunk.data.length).toBe(9 * 9 * 9);
      for (let i = 0; i < chunk.data.length; i++) {
        expect(chunk.data[i]).toBe(1.0);
      }
    });

    it('data is writable', () => {
      const chunk = new Chunk({ x: 0, y: 0, z: 0 }, TEST_CONFIG);
      const s = chunk.samples;
      const idx = 5 * s * s + 4 * s + 3; // iz=5, iy=4, ix=3
      chunk.data[idx] = -0.5;
      expect(chunk.data[idx]).toBe(-0.5);
      expect(chunk.data[0]).toBe(1.0);
    });
  });

  describe('SDFVolume', () => {
    it('creates chunks on demand', () => {
      const vol = new SDFVolume(TEST_CONFIG);
      expect(vol.chunkCount).toBe(0);
      vol.getOrCreateChunk({ x: 0, y: 0, z: 0 });
      expect(vol.chunkCount).toBe(1);
    });

    it('converts world position to chunk coord', () => {
      const vol = new SDFVolume(TEST_CONFIG);
      const coord = vol.worldToChunkCoord(0.05, 0.05, 0.05);
      expect(coord).toEqual({ x: 0, y: 0, z: 0 });
      expect(vol.worldToChunkCoord(0.09, 0, 0).x).toBe(1);
    });

    it('only returns chunks whose bounds actually intersect the brush sphere', () => {
      const vol = new SDFVolume(TEST_CONFIG);

      const coords = vol
        .chunksInSphere(0.0795, 0.0795, 0.04, 0.0006)
        .map((coord) => chunkKey(coord))
        .sort();

      expect(coords).toEqual([
        '0,0,0',
        '0,1,0',
        '1,0,0',
      ]);
    });

    it('syncs shared boundary samples into existing neighbors', () => {
      const vol = new SDFVolume(TEST_CONFIG);
      const left = vol.getOrCreateChunk({ x: 0, y: 0, z: 0 });
      const right = vol.getOrCreateChunk({ x: 1, y: 0, z: 0 });
      const cs = TEST_CONFIG.chunkSize;

      left.set(cs, 4, 5, -0.25);

      const extra = vol.syncBoundaries([left]);

      expect(extra).toEqual([right]);
      expect(right.dirty).toBe(true);
      expect(right.get(0, 4, 5)).toBe(-0.25);
    });

    it('queues seam neighbors even when only the ghost slice changed', () => {
      const vol = new SDFVolume(TEST_CONFIG);
      const left = vol.getOrCreateChunk({ x: 0, y: 0, z: 0 });
      const right = vol.getOrCreateChunk({ x: 1, y: 0, z: 0 });
      const cs = TEST_CONFIG.chunkSize;

      left.set(cs - 1, 4, 5, -0.125);
      const extra = vol.syncBoundaries([left]);

      expect(extra).toEqual([right]);
      expect(right.dirty).toBe(true);
      expect(right.get(0, 4, 5)).toBe(TEST_CONFIG.emptyValue);
    });

    it('uses the lower-coordinate chunk as the boundary authority', () => {
      const vol = new SDFVolume(TEST_CONFIG);
      const left = vol.getOrCreateChunk({ x: 0, y: 0, z: 0 });
      const right = vol.getOrCreateChunk({ x: 1, y: 0, z: 0 });
      const cs = TEST_CONFIG.chunkSize;

      left.set(cs, 2, 3, -0.5);
      right.set(0, 2, 3, 0.75);

      const extra = vol.syncBoundaries([left, right]);

      expect(extra).toEqual([]);
      expect(right.get(0, 2, 3)).toBe(-0.5);
    });

    it('smooth seam sampling reads the opposite chunk interior instead of clamping locally', () => {
      const left = new Chunk({ x: 0, y: 0, z: 0 }, TEST_CONFIG);
      const right = new Chunk({ x: 1, y: 0, z: 0 }, TEST_CONFIG);
      const cs = TEST_CONFIG.chunkSize;

      seedSharedXSeam(left, right);

      const padded = buildPaddedCpu(left, { nxp: right }, TEST_CONFIG);
      const seamAware = laplacianFromPadded(padded, left.samples, cs, 4, 5);
      const clamped = laplacianWithLocalClamp(left, cs, 4, 5);

      expect(seamAware).toBeCloseTo(-1 / 60, 6);
      expect(Math.abs(seamAware - clamped)).toBeGreaterThan(0.01);
    });

    it('smooth seam sampling produces the same shared boundary value from both chunks', () => {
      const left = new Chunk({ x: 0, y: 0, z: 0 }, TEST_CONFIG);
      const right = new Chunk({ x: 1, y: 0, z: 0 }, TEST_CONFIG);
      const cs = TEST_CONFIG.chunkSize;

      seedSharedXSeam(left, right);

      const leftPadded = buildPaddedCpu(left, { nxp: right }, TEST_CONFIG);
      const rightPadded = buildPaddedCpu(right, { nxm: left }, TEST_CONFIG);
      const leftValue = laplacianFromPadded(leftPadded, left.samples, cs, 4, 5);
      const rightValue = laplacianFromPadded(rightPadded, right.samples, 0, 4, 5);

      expect(leftValue).toBeCloseTo(rightValue, 6);
    });

    it('smooth seam sampling falls back to empty space when the face neighbor is missing', () => {
      const chunk = new Chunk({ x: 0, y: 0, z: 0 }, TEST_CONFIG);
      const cs = TEST_CONFIG.chunkSize;

      chunk.set(cs, 4, 5, 0.4);
      chunk.set(cs - 1, 4, 5, -0.6);
      chunk.set(cs, 3, 5, -0.4);
      chunk.set(cs, 5, 5, 0.3);
      chunk.set(cs, 4, 4, -0.1);
      chunk.set(cs, 4, 6, 0.5);

      const padded = buildPaddedCpu(chunk, {}, TEST_CONFIG);
      const seamAware = laplacianFromPadded(padded, chunk.samples, cs, 4, 5);
      const clamped = laplacianWithLocalClamp(chunk, cs, 4, 5);

      expect(seamAware).toBeCloseTo(7 / 60, 6);
      expect(Math.abs(seamAware - clamped)).toBeGreaterThan(0.01);
    });
  });

  describe('Marching Tables', () => {
    it('have expected dimensions', () => {
      expect(EDGE_TABLE.length).toBe(256);
      expect(TRI_TABLE.length).toBe(256 * 16);
    });
  });

  describe('Type utilities', () => {
    it('chunkKey and parseChunkKey are inverses', () => {
      const original = { x: -5, y: 10, z: 0 };
      const parsed = parseChunkKey(chunkKey(original));
      expect(parsed).toEqual(original);
    });
  });
});
