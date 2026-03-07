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
}
