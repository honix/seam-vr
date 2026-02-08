import type { TaperParams } from './deformer-types';

/**
 * Apply taper deformation to vertex positions in place.
 * Scales cross-section proportionally along the specified axis.
 * At axis min -> scale=1, at axis max -> scale=factor. Linear interpolation.
 */
export function applyTaper(
  positions: Float32Array,
  _normals: Float32Array,
  params: TaperParams
): void {
  const { factor, axis } = params;
  if (Math.abs(factor - 1.0) < 1e-6) return;

  const axisMap = { x: 0, y: 1, z: 2 } as const;
  const primary = axisMap[axis];

  // Find extent along primary axis
  let minP = Infinity, maxP = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const v = positions[i + primary];
    if (v < minP) minP = v;
    if (v > maxP) maxP = v;
  }
  const extent = maxP - minP;
  if (extent < 1e-6) return;

  // Determine the two cross-section axes
  const cross1 = (primary + 1) % 3;
  const cross2 = (primary + 2) % 3;

  for (let i = 0; i < positions.length; i += 3) {
    const p = positions[i + primary];
    // t=0 at min, t=1 at max
    const t = (p - minP) / extent;
    const scale = 1.0 + (factor - 1.0) * t;
    positions[i + cross1] *= scale;
    positions[i + cross2] *= scale;
  }
}
