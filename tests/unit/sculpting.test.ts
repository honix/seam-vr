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

    it('does not dirty neighbors when the shared boundary is unchanged', () => {
      const vol = new SDFVolume(TEST_CONFIG);
      const left = vol.getOrCreateChunk({ x: 0, y: 0, z: 0 });
      vol.getOrCreateChunk({ x: 1, y: 0, z: 0 });

      const extra = vol.syncBoundaries([left]);

      expect(extra).toEqual([]);
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
