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

  /**
   * Create a padded SDF buffer for a chunk, with 1 extra sample on each face
   * populated from neighbor chunks. This allows correct normal computation
   * at chunk boundaries (no clamped gradients).
   * Returns Float32Array of size (samples+2)^3 where samples = chunkSize+1.
   */
  createPaddedBuffer(coord: ChunkCoord): Float32Array {
    const cs = this.config.chunkSize;
    const vs = this.config.voxelSize;
    const samples = cs + 1;
    const padded = samples + 2;
    const buf = new Float32Array(padded * padded * padded);
    buf.fill(this.config.emptyValue);

    const chunk = this.getChunk(coord);
    if (!chunk) return buf;

    // Copy chunk data into center of padded buffer (offset by 1)
    for (let iz = 0; iz < samples; iz++) {
      for (let iy = 0; iy < samples; iy++) {
        for (let ix = 0; ix < samples; ix++) {
          buf[(iz + 1) * padded * padded + (iy + 1) * padded + (ix + 1)] =
            chunk.get(ix, iy, iz);
        }
      }
    }

    // Fill boundary padding from neighbor chunks
    // For each of 6 faces, copy the adjacent slice from the neighbor
    const neighbors: [number, number, number, number, number, number][] = [
      // [dx, dy, dz, srcSlice, dstSlice, axis]
      // -X face: neighbor at (coord.x-1), take its last X slice
      // +X face: neighbor at (coord.x+1), take its first X slice
    ];

    // -X neighbor: ghost is one step before our ix=0, i.e. neighbor's ix=cs-1
    const nxm = this.getChunk({ x: coord.x - 1, y: coord.y, z: coord.z });
    if (nxm) {
      for (let iz = 0; iz < samples; iz++) {
        for (let iy = 0; iy < samples; iy++) {
          buf[(iz + 1) * padded * padded + (iy + 1) * padded + 0] =
            nxm.get(cs - 1, iy, iz);
        }
      }
    }
    // +X neighbor: ghost is one step after our ix=cs, i.e. neighbor's ix=1
    const nxp = this.getChunk({ x: coord.x + 1, y: coord.y, z: coord.z });
    if (nxp) {
      for (let iz = 0; iz < samples; iz++) {
        for (let iy = 0; iy < samples; iy++) {
          buf[(iz + 1) * padded * padded + (iy + 1) * padded + (padded - 1)] =
            nxp.get(1, iy, iz);
        }
      }
    }
    // -Y neighbor: ghost is neighbor's iy=cs-1
    const nym = this.getChunk({ x: coord.x, y: coord.y - 1, z: coord.z });
    if (nym) {
      for (let iz = 0; iz < samples; iz++) {
        for (let ix = 0; ix < samples; ix++) {
          buf[(iz + 1) * padded * padded + 0 * padded + (ix + 1)] =
            nym.get(ix, cs - 1, iz);
        }
      }
    }
    // +Y neighbor: ghost is neighbor's iy=1
    const nyp = this.getChunk({ x: coord.x, y: coord.y + 1, z: coord.z });
    if (nyp) {
      for (let iz = 0; iz < samples; iz++) {
        for (let ix = 0; ix < samples; ix++) {
          buf[(iz + 1) * padded * padded + (padded - 1) * padded + (ix + 1)] =
            nyp.get(ix, 1, iz);
        }
      }
    }
    // -Z neighbor: ghost is neighbor's iz=cs-1
    const nzm = this.getChunk({ x: coord.x, y: coord.y, z: coord.z - 1 });
    if (nzm) {
      for (let iy = 0; iy < samples; iy++) {
        for (let ix = 0; ix < samples; ix++) {
          buf[0 * padded * padded + (iy + 1) * padded + (ix + 1)] =
            nzm.get(ix, iy, cs - 1);
        }
      }
    }
    // +Z neighbor: ghost is neighbor's iz=1
    const nzp = this.getChunk({ x: coord.x, y: coord.y, z: coord.z + 1 });
    if (nzp) {
      for (let iy = 0; iy < samples; iy++) {
        for (let ix = 0; ix < samples; ix++) {
          buf[(padded - 1) * padded * padded + (iy + 1) * padded + (ix + 1)] =
            nzp.get(ix, iy, 1);
        }
      }
    }

    return buf;
  }

  /**
   * Sync shared boundary samples between modified chunks and their neighbors.
   * Uses "lower coord wins" rule: always copy in +X/+Y/+Z direction (so the
   * lower-coordinate chunk's upper face overwrites the higher chunk's lower face).
   * For negative directions, only copy if the neighbor is NOT in the modified set
   * (to handle the case where only the higher-coord chunk was modified).
   * Returns additional chunks that need remeshing.
   */
  syncBoundaries(modifiedChunks: Chunk[]): Chunk[] {
    const cs = this.config.chunkSize;
    const samples = cs + 1;
    const modifiedKeys = new Set(modifiedChunks.map(c => chunkKey(c.coord)));
    const additionalDirty: Chunk[] = [];
    const seen = new Set<string>();

    const markDirty = (c: Chunk, key: string) => {
      if (!seen.has(key) && !modifiedKeys.has(key)) {
        c.dirty = true;
        additionalDirty.push(c);
      }
      seen.add(key);
    };

    for (const chunk of modifiedChunks) {
      const { x, y, z } = chunk.coord;

      // Positive directions: ALWAYS copy (lower coord is authoritative)
      // +X: our ix=cs → neighbor's ix=0
      const nxp = this.getChunk({ x: x + 1, y, z });
      if (nxp) {
        for (let iz = 0; iz < samples; iz++)
          for (let iy = 0; iy < samples; iy++)
            nxp.set(0, iy, iz, chunk.get(cs, iy, iz));
        markDirty(nxp, chunkKey({ x: x + 1, y, z }));
      }

      // +Y: our iy=cs → neighbor's iy=0
      const nyp = this.getChunk({ x, y: y + 1, z });
      if (nyp) {
        for (let iz = 0; iz < samples; iz++)
          for (let ix = 0; ix < samples; ix++)
            nyp.set(ix, 0, iz, chunk.get(ix, cs, iz));
        markDirty(nyp, chunkKey({ x, y: y + 1, z }));
      }

      // +Z: our iz=cs → neighbor's iz=0
      const nzp = this.getChunk({ x, y, z: z + 1 });
      if (nzp) {
        for (let iy = 0; iy < samples; iy++)
          for (let ix = 0; ix < samples; ix++)
            nzp.set(ix, iy, 0, chunk.get(ix, iy, cs));
        markDirty(nzp, chunkKey({ x, y, z: z + 1 }));
      }

      // Negative directions: only if neighbor is NOT modified
      // (if neighbor IS modified, it handles the sync from its positive side)
      // -X: our ix=0 → neighbor's ix=cs
      if (!modifiedKeys.has(chunkKey({ x: x - 1, y, z }))) {
        const nxm = this.getChunk({ x: x - 1, y, z });
        if (nxm) {
          for (let iz = 0; iz < samples; iz++)
            for (let iy = 0; iy < samples; iy++)
              nxm.set(cs, iy, iz, chunk.get(0, iy, iz));
          markDirty(nxm, chunkKey({ x: x - 1, y, z }));
        }
      }

      // -Y: our iy=0 → neighbor's iy=cs
      if (!modifiedKeys.has(chunkKey({ x, y: y - 1, z }))) {
        const nym = this.getChunk({ x, y: y - 1, z });
        if (nym) {
          for (let iz = 0; iz < samples; iz++)
            for (let ix = 0; ix < samples; ix++)
              nym.set(ix, cs, iz, chunk.get(ix, 0, iz));
          markDirty(nym, chunkKey({ x, y: y - 1, z }));
        }
      }

      // -Z: our iz=0 → neighbor's iz=cs
      if (!modifiedKeys.has(chunkKey({ x, y, z: z - 1 }))) {
        const nzm = this.getChunk({ x, y, z: z - 1 });
        if (nzm) {
          for (let iy = 0; iy < samples; iy++)
            for (let ix = 0; ix < samples; ix++)
              nzm.set(ix, iy, cs, chunk.get(ix, iy, 0));
          markDirty(nzm, chunkKey({ x, y, z: z - 1 }));
        }
      }
    }

    return additionalDirty;
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
