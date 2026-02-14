// Sculpting system types

export type BrushType = 'add' | 'subtract' | 'move';

export interface BrushParams {
  type: BrushType;
  center: [number, number, number];
  radius: number;
  strength: number;
  smoothing: number; // k parameter for smooth min/max
}

export interface ChunkCoord {
  x: number;
  y: number;
  z: number;
}

export interface SculptConfig {
  /** Number of cells per chunk dimension (samples = cells + 1) */
  chunkSize: number;
  /** World-space size of each voxel */
  voxelSize: number;
  /** SDF value for "empty" (far from surface) */
  emptyValue: number;
}

export const DEFAULT_SCULPT_CONFIG: SculptConfig = {
  chunkSize: 32,
  voxelSize: 0.002, // 2mm voxels
  emptyValue: 1.0,
};

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  /** GPU path: raw interleaved [x,y,z,nx,ny,nz,...] — skip de-interleave */
  interleaved?: Float32Array;
  vertexCount: number;
}

export function chunkKey(coord: ChunkCoord): string {
  return `${coord.x},${coord.y},${coord.z}`;
}

export function parseChunkKey(key: string): ChunkCoord {
  const [x, y, z] = key.split(',').map(Number);
  return { x, y, z };
}
