// Brush operations for SDF sculpting (CPU path)
// Each brush modifies SDF values in affected chunks.

import type { Chunk } from './chunk';
import type { SDFVolume } from './sdf-volume';
import type { BrushParams, SculptConfig } from './types';

/** Smooth minimum (polynomial) for blending SDFs */
export function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Smooth maximum for smooth subtraction */
export function smoothMax(a: number, b: number, k: number): number {
  return -smoothMin(-a, -b, k);
}

/** Sphere SDF: distance from point to sphere surface */
export function sphereSDF(
  px: number, py: number, pz: number,
  cx: number, cy: number, cz: number,
  radius: number
): number {
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
}

/**
 * Apply a brush stroke to a single chunk.
 * Returns true if any voxel was modified.
 */
export function applyBrushToChunk(
  chunk: Chunk,
  brush: BrushParams,
  config: SculptConfig
): boolean {
  const cs = config.chunkSize;
  const vs = config.voxelSize;
  const samples = cs + 1;
  const originX = chunk.coord.x * cs * vs;
  const originY = chunk.coord.y * cs * vs;
  const originZ = chunk.coord.z * cs * vs;

  const [bcx, bcy, bcz] = brush.center;
  const brushRadius = brush.radius;
  const strength = brush.strength;
  const smoothing = brush.smoothing;

  // Compute local bounds of affected samples
  const minIx = Math.max(0, Math.floor((bcx - brushRadius - originX) / vs) - 1);
  const maxIx = Math.min(samples - 1, Math.ceil((bcx + brushRadius - originX) / vs) + 1);
  const minIy = Math.max(0, Math.floor((bcy - brushRadius - originY) / vs) - 1);
  const maxIy = Math.min(samples - 1, Math.ceil((bcy + brushRadius - originY) / vs) + 1);
  const minIz = Math.max(0, Math.floor((bcz - brushRadius - originZ) / vs) - 1);
  const maxIz = Math.min(samples - 1, Math.ceil((bcz + brushRadius - originZ) / vs) + 1);

  if (minIx > maxIx || minIy > maxIy || minIz > maxIz) return false;

  let modified = false;

  for (let iz = minIz; iz <= maxIz; iz++) {
    for (let iy = minIy; iy <= maxIy; iy++) {
      for (let ix = minIx; ix <= maxIx; ix++) {
        const wx = originX + ix * vs;
        const wy = originY + iy * vs;
        const wz = originZ + iz * vs;

        const brushDist = sphereSDF(wx, wy, wz, bcx, bcy, bcz, brushRadius * strength);
        const currentSDF = chunk.get(ix, iy, iz);
        let newSDF: number;

        switch (brush.type) {
          case 'add':
            // Union: bring SDF closer to surface/inside
            newSDF = smoothMin(currentSDF, brushDist, smoothing);
            break;
          case 'subtract':
            // Subtraction: push SDF away from surface/outside
            newSDF = smoothMax(currentSDF, -brushDist, smoothing);
            break;
          default:
            newSDF = currentSDF;
        }

        if (newSDF !== currentSDF) {
          chunk.set(ix, iy, iz, newSDF);
          modified = true;
        }
      }
    }
  }

  return modified;
}

/**
 * Apply a brush stroke to the volume, affecting all overlapping chunks.
 * Returns the list of chunks that were modified (and need remeshing).
 */
export function applyBrush(
  volume: SDFVolume,
  brush: BrushParams
): Chunk[] {
  // Find all chunks the brush overlaps
  const [cx, cy, cz] = brush.center;
  // Extend search radius to account for smoothing influence
  const searchRadius = brush.radius + brush.smoothing;
  const affectedCoords = volume.chunksInSphere(cx, cy, cz, searchRadius);

  const modifiedChunks: Chunk[] = [];

  for (const coord of affectedCoords) {
    const chunk = volume.getOrCreateChunk(coord);
    const wasModified = applyBrushToChunk(chunk, brush, volume.config);
    if (wasModified) {
      chunk.dirty = true;
      chunk.updateEmpty();
      modifiedChunks.push(chunk);
    }
  }

  return modifiedChunks;
}

/**
 * Move brush state machine.
 * Captures SDF material at the grab point, removes it, then re-adds it
 * at the current controller position each frame.
 */
export class MoveBrush {
  private capturedSDF: Float32Array | null = null;
  private captureCenter: [number, number, number] = [0, 0, 0];
  private captureRadius: number = 0;
  private captureGridSize: number = 0;
  private lastApplyCenter: [number, number, number] | null = null;

  /**
   * Begin a move operation: capture SDF values around center
   */
  beginMove(
    volume: SDFVolume,
    center: [number, number, number],
    radius: number
  ): void {
    this.captureCenter = [...center];
    this.captureRadius = radius;

    const vs = volume.config.voxelSize;
    // Capture grid extends from center-radius to center+radius
    this.captureGridSize = Math.ceil((radius * 2) / vs) + 2;
    const gridSize = this.captureGridSize;
    this.capturedSDF = new Float32Array(gridSize * gridSize * gridSize);

    // Sample the volume at grid points
    const startX = center[0] - radius;
    const startY = center[1] - radius;
    const startZ = center[2] - radius;

    for (let iz = 0; iz < gridSize; iz++) {
      for (let iy = 0; iy < gridSize; iy++) {
        for (let ix = 0; ix < gridSize; ix++) {
          const wx = startX + ix * vs;
          const wy = startY + iy * vs;
          const wz = startZ + iz * vs;
          const val = volume.sampleAt(wx, wy, wz);
          this.capturedSDF[iz * gridSize * gridSize + iy * gridSize + ix] = val;
        }
      }
    }

    // Subtract the captured region from the volume (erase material)
    applyBrush(volume, {
      type: 'subtract',
      center,
      radius,
      strength: 1.0,
      smoothing: 0.002,
    });

    this.lastApplyCenter = null;
  }

  /**
   * Update move: re-stamp captured SDF at new position
   */
  updateMove(
    volume: SDFVolume,
    newCenter: [number, number, number]
  ): Chunk[] {
    if (!this.capturedSDF) return [];

    // If we previously stamped, remove old stamp
    if (this.lastApplyCenter) {
      this.stampCaptured(volume, this.lastApplyCenter, true);
    }

    // Stamp at new position
    const modified = this.stampCaptured(volume, newCenter, false);
    this.lastApplyCenter = [...newCenter];
    return modified;
  }

  /**
   * End move operation: finalize the stamp at current position
   */
  endMove(): void {
    this.capturedSDF = null;
    this.lastApplyCenter = null;
  }

  get isActive(): boolean {
    return this.capturedSDF !== null;
  }

  /**
   * Stamp the captured SDF into the volume.
   * If remove=true, subtract it; otherwise add it.
   */
  private stampCaptured(
    volume: SDFVolume,
    center: [number, number, number],
    remove: boolean
  ): Chunk[] {
    if (!this.capturedSDF) return [];

    const vs = volume.config.voxelSize;
    const gridSize = this.captureGridSize;
    const radius = this.captureRadius;

    const startX = center[0] - radius;
    const startY = center[1] - radius;
    const startZ = center[2] - radius;

    // Find affected chunks
    const affectedCoords = volume.chunksInSphere(
      center[0], center[1], center[2], radius
    );

    const modifiedChunks: Chunk[] = [];
    const cs = volume.config.chunkSize;

    for (const coord of affectedCoords) {
      const chunk = volume.getOrCreateChunk(coord);
      const originX = coord.x * cs * vs;
      const originY = coord.y * cs * vs;
      const originZ = coord.z * cs * vs;
      let modified = false;

      for (let iz = 0; iz <= cs; iz++) {
        for (let iy = 0; iy <= cs; iy++) {
          for (let ix = 0; ix <= cs; ix++) {
            const wx = originX + ix * vs;
            const wy = originY + iy * vs;
            const wz = originZ + iz * vs;

            // Position in capture grid
            const gx = (wx - startX) / vs;
            const gy = (wy - startY) / vs;
            const gz = (wz - startZ) / vs;

            if (gx < 0 || gx >= gridSize - 1 ||
                gy < 0 || gy >= gridSize - 1 ||
                gz < 0 || gz >= gridSize - 1) continue;

            // Trilinear interpolation of captured SDF
            const gxi = Math.floor(gx);
            const gyi = Math.floor(gy);
            const gzi = Math.floor(gz);
            const fx = gx - gxi;
            const fy = gy - gyi;
            const fz = gz - gzi;

            const idx = (i: number, j: number, k: number) =>
              k * gridSize * gridSize + j * gridSize + i;

            const c000 = this.capturedSDF![idx(gxi, gyi, gzi)];
            const c100 = this.capturedSDF![idx(gxi + 1, gyi, gzi)];
            const c010 = this.capturedSDF![idx(gxi, gyi + 1, gzi)];
            const c110 = this.capturedSDF![idx(gxi + 1, gyi + 1, gzi)];
            const c001 = this.capturedSDF![idx(gxi, gyi, gzi + 1)];
            const c101 = this.capturedSDF![idx(gxi + 1, gyi, gzi + 1)];
            const c011 = this.capturedSDF![idx(gxi, gyi + 1, gzi + 1)];
            const c111 = this.capturedSDF![idx(gxi + 1, gyi + 1, gzi + 1)];

            const c00 = c000 * (1 - fx) + c100 * fx;
            const c10 = c010 * (1 - fx) + c110 * fx;
            const c01 = c001 * (1 - fx) + c101 * fx;
            const c11 = c011 * (1 - fx) + c111 * fx;
            const c0 = c00 * (1 - fy) + c10 * fy;
            const c1 = c01 * (1 - fy) + c11 * fy;
            const capturedVal = c0 * (1 - fz) + c1 * fz;

            // Only apply if the captured value represents material (negative SDF)
            if (capturedVal >= 0) continue;

            const currentSDF = chunk.get(ix, iy, iz);
            let newSDF: number;

            if (remove) {
              // Remove by subtracting (push outward)
              newSDF = smoothMax(currentSDF, -capturedVal, 0.002);
            } else {
              // Add by union
              newSDF = smoothMin(currentSDF, capturedVal, 0.002);
            }

            if (newSDF !== currentSDF) {
              chunk.set(ix, iy, iz, newSDF);
              modified = true;
            }
          }
        }
      }

      if (modified) {
        chunk.dirty = true;
        chunk.updateEmpty();
        modifiedChunks.push(chunk);
      }
    }

    return modifiedChunks;
  }
}
