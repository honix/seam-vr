import type { Vec3 } from '../types';
import type { LatticeParams } from './deformer-types';

/**
 * Apply lattice deformation to vertex positions in place.
 * Uses trilinear interpolation of control point offsets.
 * Maps vertex positions to [0,1] within bounding box, then interpolates
 * control point displacements.
 */
export function applyLattice(
  positions: Float32Array,
  _normals: Float32Array,
  params: LatticeParams
): void {
  const { resolution, points } = params;
  const expectedCount = resolution ** 3;
  if (points.length !== expectedCount) return;

  // Compute bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const extX = maxX - minX;
  const extY = maxY - minY;
  const extZ = maxZ - minZ;

  // Compute default lattice positions (undeformed) for the given resolution
  const defaultPoints: Vec3[] = [];
  for (let iz = 0; iz < resolution; iz++) {
    for (let iy = 0; iy < resolution; iy++) {
      for (let ix = 0; ix < resolution; ix++) {
        const fx = resolution > 1 ? ix / (resolution - 1) : 0.5;
        const fy = resolution > 1 ? iy / (resolution - 1) : 0.5;
        const fz = resolution > 1 ? iz / (resolution - 1) : 0.5;
        defaultPoints.push([
          minX + fx * extX,
          minY + fy * extY,
          minZ + fz * extZ,
        ]);
      }
    }
  }

  // Compute offsets (displacement from default position)
  const offsets: Vec3[] = points.map((p, i) => [
    p[0] - defaultPoints[i][0],
    p[1] - defaultPoints[i][1],
    p[2] - defaultPoints[i][2],
  ]);

  // Helper to get offset at lattice index (ix, iy, iz)
  const getOffset = (ix: number, iy: number, iz: number): Vec3 => {
    const idx = iz * resolution * resolution + iy * resolution + ix;
    return offsets[idx];
  };

  // Trilinear interpolation for each vertex
  const n = resolution - 1;
  for (let i = 0; i < positions.length; i += 3) {
    // Map to [0, 1] within bounding box
    const u = extX > 1e-6 ? (positions[i] - minX) / extX : 0.5;
    const v = extY > 1e-6 ? (positions[i + 1] - minY) / extY : 0.5;
    const w = extZ > 1e-6 ? (positions[i + 2] - minZ) / extZ : 0.5;

    // Map to lattice cell coordinates
    const lu = Math.max(0, Math.min(n, u * n));
    const lv = Math.max(0, Math.min(n, v * n));
    const lw = Math.max(0, Math.min(n, w * n));

    const ix0 = Math.min(Math.floor(lu), n - 1);
    const iy0 = Math.min(Math.floor(lv), n - 1);
    const iz0 = Math.min(Math.floor(lw), n - 1);

    const fx = lu - ix0;
    const fy = lv - iy0;
    const fz = lw - iz0;

    // Trilinear interpolation of offsets
    let dx = 0, dy = 0, dz = 0;
    for (let diz = 0; diz <= 1; diz++) {
      for (let diy = 0; diy <= 1; diy++) {
        for (let dix = 0; dix <= 1; dix++) {
          const wt =
            (dix === 0 ? 1 - fx : fx) *
            (diy === 0 ? 1 - fy : fy) *
            (diz === 0 ? 1 - fz : fz);
          const off = getOffset(ix0 + dix, iy0 + diy, iz0 + diz);
          dx += wt * off[0];
          dy += wt * off[1];
          dz += wt * off[2];
        }
      }
    }

    positions[i] += dx;
    positions[i + 1] += dy;
    positions[i + 2] += dz;
  }
}
