// SDF Volume - manages a sparse set of chunks covering the sculpted region

import { Chunk } from './chunk';
import type { ChunkCoord, SculptConfig } from './types';
import { chunkKey } from './types';

export class SDFVolume {
  readonly config: SculptConfig;
  private chunks: Map<string, Chunk> = new Map();

  constructor(config: SculptConfig) {
    this.config = config;
  }

  /** Get or create chunk at the given coordinate */
  getOrCreateChunk(coord: ChunkCoord): Chunk {
    const key = chunkKey(coord);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(coord, this.config);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  /** Get chunk if it exists (returns undefined for unallocated) */
  getChunk(coord: ChunkCoord): Chunk | undefined {
    return this.chunks.get(chunkKey(coord));
  }

  /** Remove a chunk (e.g., if it becomes fully empty) */
  removeChunk(coord: ChunkCoord): void {
    this.chunks.delete(chunkKey(coord));
  }

  /** Get all allocated chunks */
  allChunks(): Chunk[] {
    return Array.from(this.chunks.values());
  }

  /** Get all dirty chunks */
  dirtyChunks(): Chunk[] {
    return this.allChunks().filter(c => c.dirty);
  }

  /** Clear dirty flag on all chunks */
  clearDirty(): void {
    for (const chunk of this.chunks.values()) {
      chunk.dirty = false;
    }
  }

  /** Convert world position to chunk coordinate */
  worldToChunkCoord(wx: number, wy: number, wz: number): ChunkCoord {
    const cs = this.config.chunkSize * this.config.voxelSize;
    return {
      x: Math.floor(wx / cs),
      y: Math.floor(wy / cs),
      z: Math.floor(wz / cs),
    };
  }

  /** Get all chunk coords that a sphere at (cx,cy,cz) with radius r overlaps */
  chunksInSphere(
    cx: number,
    cy: number,
    cz: number,
    radius: number
  ): ChunkCoord[] {
    const cs = this.config.chunkSize * this.config.voxelSize;
    const minCoord = this.worldToChunkCoord(cx - radius, cy - radius, cz - radius);
    const maxCoord = this.worldToChunkCoord(cx + radius, cy + radius, cz + radius);

    const coords: ChunkCoord[] = [];
    for (let z = minCoord.z; z <= maxCoord.z; z++) {
      for (let y = minCoord.y; y <= maxCoord.y; y++) {
        for (let x = minCoord.x; x <= maxCoord.x; x++) {
          coords.push({ x, y, z });
        }
      }
    }
    return coords;
  }

  /** Total number of allocated chunks */
  get chunkCount(): number {
    return this.chunks.size;
  }

  /** Get SDF value at arbitrary world position (trilinear interpolation) */
  sampleAt(wx: number, wy: number, wz: number): number {
    const vs = this.config.voxelSize;
    const cs = this.config.chunkSize;
    const chunkWorldSize = cs * vs;

    const coord = this.worldToChunkCoord(wx, wy, wz);
    const chunk = this.getChunk(coord);
    if (!chunk) return this.config.emptyValue;

    // Local position within chunk
    const lx = (wx - coord.x * chunkWorldSize) / vs;
    const ly = (wy - coord.y * chunkWorldSize) / vs;
    const lz = (wz - coord.z * chunkWorldSize) / vs;

    // Integer sample indices
    const ix = Math.floor(lx);
    const iy = Math.floor(ly);
    const iz = Math.floor(lz);

    // Fractional part
    const fx = lx - ix;
    const fy = ly - iy;
    const fz = lz - iz;

    const s = chunk.samples - 1;
    const x0 = Math.min(ix, s);
    const y0 = Math.min(iy, s);
    const z0 = Math.min(iz, s);
    const x1 = Math.min(ix + 1, s);
    const y1 = Math.min(iy + 1, s);
    const z1 = Math.min(iz + 1, s);

    // Trilinear interpolation
    const c000 = chunk.get(x0, y0, z0);
    const c100 = chunk.get(x1, y0, z0);
    const c010 = chunk.get(x0, y1, z0);
    const c110 = chunk.get(x1, y1, z0);
    const c001 = chunk.get(x0, y0, z1);
    const c101 = chunk.get(x1, y0, z1);
    const c011 = chunk.get(x0, y1, z1);
    const c111 = chunk.get(x1, y1, z1);

    const c00 = c000 * (1 - fx) + c100 * fx;
    const c10 = c010 * (1 - fx) + c110 * fx;
    const c01 = c001 * (1 - fx) + c101 * fx;
    const c11 = c011 * (1 - fx) + c111 * fx;

    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;

    return c0 * (1 - fz) + c1 * fz;
  }
}
