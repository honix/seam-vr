// CPU marching cubes mesh extraction
// Extracts a triangle mesh from SDF data stored in a Chunk.
// Used as reference implementation and fallback when WebGPU is unavailable.

import type { Chunk } from './chunk';
import type { MeshData, SculptConfig } from './types';
import { EDGE_TABLE, TRI_TABLE, EDGE_VERTICES, CUBE_VERTICES } from './marching-tables';

/** Linearly interpolate position on edge between two grid points */
function interpolateEdge(
  v1: [number, number, number],
  v2: [number, number, number],
  val1: number,
  val2: number,
  isoLevel: number
): [number, number, number] {
  if (Math.abs(val1 - val2) < 1e-10) {
    return [v1[0], v1[1], v1[2]];
  }
  const t = (isoLevel - val1) / (val2 - val1);
  return [
    v1[0] + t * (v2[0] - v1[0]),
    v1[1] + t * (v2[1] - v1[1]),
    v1[2] + t * (v2[2] - v2[2]),
  ];
}

/** Compute SDF gradient (normal) via central differences */
function computeNormal(
  chunk: Chunk,
  ix: number,
  iy: number,
  iz: number
): [number, number, number] {
  const s = chunk.samples;
  const x0 = ix > 0 ? ix - 1 : ix;
  const x1 = ix < s - 1 ? ix + 1 : ix;
  const y0 = iy > 0 ? iy - 1 : iy;
  const y1 = iy < s - 1 ? iy + 1 : iy;
  const z0 = iz > 0 ? iz - 1 : iz;
  const z1 = iz < s - 1 ? iz + 1 : iz;

  const nx = chunk.get(x1, iy, iz) - chunk.get(x0, iy, iz);
  const ny = chunk.get(ix, y1, iz) - chunk.get(ix, y0, iz);
  const nz = chunk.get(ix, iy, z1) - chunk.get(ix, iy, z0);

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 1e-10) return [0, 1, 0]; // default up normal
  return [nx / len, ny / len, nz / len];
}

/** Interpolate normal between two grid points */
function interpolateNormal(
  chunk: Chunk,
  ix1: number, iy1: number, iz1: number,
  ix2: number, iy2: number, iz2: number,
  val1: number, val2: number,
  isoLevel: number
): [number, number, number] {
  const t = Math.abs(val2 - val1) < 1e-10 ? 0.5 : (isoLevel - val1) / (val2 - val1);
  const n1 = computeNormal(chunk, ix1, iy1, iz1);
  const n2 = computeNormal(chunk, ix2, iy2, iz2);

  const nx = n1[0] + t * (n2[0] - n1[0]);
  const ny = n1[1] + t * (n2[1] - n1[1]);
  const nz = n1[2] + t * (n2[2] - n1[2]);

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 1e-10) return [0, 1, 0];
  return [nx / len, ny / len, nz / len];
}

/**
 * Extract mesh from a chunk using marching cubes.
 * Returns positions and normals in world space.
 */
export function extractMesh(
  chunk: Chunk,
  config: SculptConfig,
  isoLevel: number = 0
): MeshData {
  const cs = config.chunkSize;
  const vs = config.voxelSize;
  const originX = chunk.coord.x * cs * vs;
  const originY = chunk.coord.y * cs * vs;
  const originZ = chunk.coord.z * cs * vs;

  // Pre-allocate generous arrays (will trim at end)
  // Max theoretical: cs^3 cells * 5 triangles * 3 vertices = 15 * cs^3
  // In practice much less, allocate for ~20% fill
  const estimatedVerts = Math.ceil(cs * cs * cs * 0.2) * 15;
  let positions = new Float32Array(estimatedVerts * 3);
  let normals = new Float32Array(estimatedVerts * 3);
  let vertexCount = 0;

  function ensureCapacity(needed: number): void {
    if (vertexCount + needed <= positions.length / 3) return;
    const newSize = (vertexCount + needed) * 2;
    const newPos = new Float32Array(newSize * 3);
    const newNorm = new Float32Array(newSize * 3);
    newPos.set(positions);
    newNorm.set(normals);
    positions = newPos;
    normals = newNorm;
  }

  // Edge vertex positions and normals (12 edges per cell)
  const edgePos: [number, number, number][] = new Array(12);
  const edgeNorm: [number, number, number][] = new Array(12);

  for (let z = 0; z < cs; z++) {
    for (let y = 0; y < cs; y++) {
      for (let x = 0; x < cs; x++) {
        // Get SDF values at 8 corners of this cell
        const cornerValues: number[] = new Array(8);
        for (let i = 0; i < 8; i++) {
          const [dx, dy, dz] = CUBE_VERTICES[i];
          cornerValues[i] = chunk.get(x + dx, y + dy, z + dz);
        }

        // Compute cube index from corner signs
        let cubeIndex = 0;
        for (let i = 0; i < 8; i++) {
          if (cornerValues[i] < isoLevel) cubeIndex |= (1 << i);
        }

        // Skip empty cells (all inside or all outside)
        const edgeMask = EDGE_TABLE[cubeIndex];
        if (edgeMask === 0) continue;

        // Compute edge intersection vertices
        for (let e = 0; e < 12; e++) {
          if (!(edgeMask & (1 << e))) continue;

          const [v1, v2] = EDGE_VERTICES[e];
          const [dx1, dy1, dz1] = CUBE_VERTICES[v1];
          const [dx2, dy2, dz2] = CUBE_VERTICES[v2];

          const ix1 = x + dx1, iy1 = y + dy1, iz1 = z + dz1;
          const ix2 = x + dx2, iy2 = y + dy2, iz2 = z + dz2;

          // World positions of the two corner vertices
          const p1: [number, number, number] = [
            originX + ix1 * vs,
            originY + iy1 * vs,
            originZ + iz1 * vs,
          ];
          const p2: [number, number, number] = [
            originX + ix2 * vs,
            originY + iy2 * vs,
            originZ + iz2 * vs,
          ];

          edgePos[e] = interpolateEdge(p1, p2, cornerValues[v1], cornerValues[v2], isoLevel);
          edgeNorm[e] = interpolateNormal(
            chunk, ix1, iy1, iz1, ix2, iy2, iz2,
            cornerValues[v1], cornerValues[v2], isoLevel
          );
        }

        // Generate triangles from the tri table
        const triOffset = cubeIndex * 16;
        for (let t = 0; t < 16; t += 3) {
          const e0 = TRI_TABLE[triOffset + t];
          if (e0 === -1) break;
          const e1 = TRI_TABLE[triOffset + t + 1];
          const e2 = TRI_TABLE[triOffset + t + 2];

          ensureCapacity(3);

          const vi = vertexCount * 3;
          positions[vi] = edgePos[e0][0];
          positions[vi + 1] = edgePos[e0][1];
          positions[vi + 2] = edgePos[e0][2];
          normals[vi] = edgeNorm[e0][0];
          normals[vi + 1] = edgeNorm[e0][1];
          normals[vi + 2] = edgeNorm[e0][2];

          positions[vi + 3] = edgePos[e1][0];
          positions[vi + 4] = edgePos[e1][1];
          positions[vi + 5] = edgePos[e1][2];
          normals[vi + 3] = edgeNorm[e1][0];
          normals[vi + 4] = edgeNorm[e1][1];
          normals[vi + 5] = edgeNorm[e1][2];

          positions[vi + 6] = edgePos[e2][0];
          positions[vi + 7] = edgePos[e2][1];
          positions[vi + 8] = edgePos[e2][2];
          normals[vi + 6] = edgeNorm[e2][0];
          normals[vi + 7] = edgeNorm[e2][1];
          normals[vi + 8] = edgeNorm[e2][2];

          vertexCount += 3;
        }
      }
    }
  }

  // Trim to actual size
  return {
    positions: positions.slice(0, vertexCount * 3),
    normals: normals.slice(0, vertexCount * 3),
    vertexCount,
  };
}
