import type { NoiseParams } from './deformer-types';

/**
 * Simple hash-based pseudo-random noise function.
 * Returns a value in [-1, 1].
 */
function hash3d(x: number, y: number, z: number, seed: number): number {
  // Integer hash mixing
  let h = seed;
  h ^= Math.imul(floatBitsToInt(x), 0x45d9f3b);
  h = (h >>> 16) ^ h;
  h ^= Math.imul(floatBitsToInt(y), 0x45d9f3b);
  h = (h >>> 16) ^ h;
  h ^= Math.imul(floatBitsToInt(z), 0x119de1f3);
  h = (h >>> 16) ^ h;
  // Map to [-1, 1]
  return ((h & 0x7fffffff) / 0x7fffffff) * 2.0 - 1.0;
}

function floatBitsToInt(f: number): number {
  // Quick deterministic float->int conversion for hashing
  return (f * 1000000) | 0;
}

/**
 * Smooth noise via trilinear interpolation of hashed lattice values.
 */
function smoothNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;

  // Smoothstep
  const sx = fx * fx * (3.0 - 2.0 * fx);
  const sy = fy * fy * (3.0 - 2.0 * fy);
  const sz = fz * fz * (3.0 - 2.0 * fz);

  // Trilinear interpolation of corner hash values
  const n000 = hash3d(ix, iy, iz, seed);
  const n100 = hash3d(ix + 1, iy, iz, seed);
  const n010 = hash3d(ix, iy + 1, iz, seed);
  const n110 = hash3d(ix + 1, iy + 1, iz, seed);
  const n001 = hash3d(ix, iy, iz + 1, seed);
  const n101 = hash3d(ix + 1, iy, iz + 1, seed);
  const n011 = hash3d(ix, iy + 1, iz + 1, seed);
  const n111 = hash3d(ix + 1, iy + 1, iz + 1, seed);

  const nx00 = n000 + sx * (n100 - n000);
  const nx10 = n010 + sx * (n110 - n010);
  const nx01 = n001 + sx * (n101 - n001);
  const nx11 = n011 + sx * (n111 - n011);

  const nxy0 = nx00 + sy * (nx10 - nx00);
  const nxy1 = nx01 + sy * (nx11 - nx01);

  return nxy0 + sz * (nxy1 - nxy0);
}

/**
 * Apply noise deformation to vertex positions in place.
 * Displaces each vertex along its normal by noise-scaled amplitude.
 */
export function applyNoise(
  positions: Float32Array,
  normals: Float32Array,
  params: NoiseParams
): void {
  const { amplitude, frequency, seed = 0 } = params;
  if (Math.abs(amplitude) < 1e-6) return;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] * frequency;
    const y = positions[i + 1] * frequency;
    const z = positions[i + 2] * frequency;

    const n = smoothNoise(x, y, z, seed);
    const displacement = n * amplitude;

    // Displace along normal
    const nx = normals[i];
    const ny = normals[i + 1];
    const nz = normals[i + 2];

    positions[i] += nx * displacement;
    positions[i + 1] += ny * displacement;
    positions[i + 2] += nz * displacement;
  }
}
