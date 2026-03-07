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

}
