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

  /**
   * Sync shared boundary samples between modified chunks and their neighbors.
   * The lower-coordinate chunk owns the shared boundary plane.
   * Returns non-modified neighbors whose mesh must be rebuilt immediately.
   */
  syncBoundaries(modifiedChunks: Chunk[]): Chunk[] {
    const cs = this.config.chunkSize;
    const samples = cs + 1;
    const modifiedKeys = new Set(modifiedChunks.map(c => chunkKey(c.coord)));
    const additionalDirty: Chunk[] = [];
    const seen = new Set<string>();

    const markDirty = (chunk: Chunk, key: string) => {
      chunk.dirty = true;
      if (!modifiedKeys.has(key) && !seen.has(key)) {
        additionalDirty.push(chunk);
      }
      seen.add(key);
    };

    for (const chunk of modifiedChunks) {
      const { x, y, z } = chunk.coord;

      const nxp = this.getChunk({ x: x + 1, y, z });
      if (nxp) {
        let changed = false;
        for (let iz = 0; iz < samples; iz++) {
          for (let iy = 0; iy < samples; iy++) {
            const value = chunk.get(cs, iy, iz);
            if (nxp.get(0, iy, iz) !== value) {
              nxp.set(0, iy, iz, value);
              changed = true;
            }
          }
        }
        if (changed) {
          markDirty(nxp, chunkKey({ x: x + 1, y, z }));
        }
      }

      const nyp = this.getChunk({ x, y: y + 1, z });
      if (nyp) {
        let changed = false;
        for (let iz = 0; iz < samples; iz++) {
          for (let ix = 0; ix < samples; ix++) {
            const value = chunk.get(ix, cs, iz);
            if (nyp.get(ix, 0, iz) !== value) {
              nyp.set(ix, 0, iz, value);
              changed = true;
            }
          }
        }
        if (changed) {
          markDirty(nyp, chunkKey({ x, y: y + 1, z }));
        }
      }

      const nzp = this.getChunk({ x, y, z: z + 1 });
      if (nzp) {
        let changed = false;
        for (let iy = 0; iy < samples; iy++) {
          for (let ix = 0; ix < samples; ix++) {
            const value = chunk.get(ix, iy, cs);
            if (nzp.get(ix, iy, 0) !== value) {
              nzp.set(ix, iy, 0, value);
              changed = true;
            }
          }
        }
        if (changed) {
          markDirty(nzp, chunkKey({ x, y, z: z + 1 }));
        }
      }

      if (!modifiedKeys.has(chunkKey({ x: x - 1, y, z }))) {
        const nxm = this.getChunk({ x: x - 1, y, z });
        if (nxm) {
          let changed = false;
          for (let iz = 0; iz < samples; iz++) {
            for (let iy = 0; iy < samples; iy++) {
              const value = chunk.get(0, iy, iz);
              if (nxm.get(cs, iy, iz) !== value) {
                nxm.set(cs, iy, iz, value);
                changed = true;
              }
            }
          }
          if (changed) {
            markDirty(nxm, chunkKey({ x: x - 1, y, z }));
          }
        }
      }

      if (!modifiedKeys.has(chunkKey({ x, y: y - 1, z }))) {
        const nym = this.getChunk({ x, y: y - 1, z });
        if (nym) {
          let changed = false;
          for (let iz = 0; iz < samples; iz++) {
            for (let ix = 0; ix < samples; ix++) {
              const value = chunk.get(ix, 0, iz);
              if (nym.get(ix, cs, iz) !== value) {
                nym.set(ix, cs, iz, value);
                changed = true;
              }
            }
          }
          if (changed) {
            markDirty(nym, chunkKey({ x, y: y - 1, z }));
          }
        }
      }

      if (!modifiedKeys.has(chunkKey({ x, y, z: z - 1 }))) {
        const nzm = this.getChunk({ x, y, z: z - 1 });
        if (nzm) {
          let changed = false;
          for (let iy = 0; iy < samples; iy++) {
            for (let ix = 0; ix < samples; ix++) {
              const value = chunk.get(ix, iy, 0);
              if (nzm.get(ix, iy, cs) !== value) {
                nzm.set(ix, iy, cs, value);
                changed = true;
              }
            }
          }
          if (changed) {
            markDirty(nzm, chunkKey({ x, y, z: z - 1 }));
          }
        }
      }
    }

    return additionalDirty;
  }
}
