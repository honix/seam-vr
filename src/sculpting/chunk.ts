// SDF chunk - a fixed-size 3D grid of SDF values
// Each chunk stores (chunkSize+1)^3 samples to allow marching cubes
// to process chunkSize^3 cells. Neighboring chunks share boundary samples.

import type { ChunkCoord, SculptConfig } from './types';

export class Chunk {
  readonly coord: ChunkCoord;
  readonly samples: number; // chunkSize + 1
  readonly data: Float32Array;
  dirty: boolean = false;
  empty: boolean = true;

  constructor(coord: ChunkCoord, config: SculptConfig) {
    this.coord = coord;
    this.samples = config.chunkSize + 1;
    const totalSamples = this.samples * this.samples * this.samples;
    this.data = new Float32Array(totalSamples);
    this.data.fill(config.emptyValue);
  }

  /** Get SDF value at local sample index [ix, iy, iz] */
  get(ix: number, iy: number, iz: number): number {
    return this.data[iz * this.samples * this.samples + iy * this.samples + ix];
  }

  /** Set SDF value at local sample index */
  set(ix: number, iy: number, iz: number, value: number): void {
    this.data[iz * this.samples * this.samples + iy * this.samples + ix] = value;
  }

  /** Flat index from 3D sample coordinates */
  index(ix: number, iy: number, iz: number): number {
    return iz * this.samples * this.samples + iy * this.samples + ix;
  }

  /** World position of sample [ix, iy, iz] */
  sampleWorldPos(
    ix: number,
    iy: number,
    iz: number,
    config: SculptConfig
  ): [number, number, number] {
    const originX = this.coord.x * config.chunkSize * config.voxelSize;
    const originY = this.coord.y * config.chunkSize * config.voxelSize;
    const originZ = this.coord.z * config.chunkSize * config.voxelSize;
    return [
      originX + ix * config.voxelSize,
      originY + iy * config.voxelSize,
      originZ + iz * config.voxelSize,
    ];
  }

  /** Check if any sample is below the surface threshold */
  updateEmpty(threshold: number = 0): void {
    this.empty = true;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] <= threshold) {
        this.empty = false;
        return;
      }
    }
  }
}
