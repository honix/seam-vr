import type { TwistParams } from './deformer-types';

/**
 * Apply twist deformation to vertex positions in place.
 * Rotates cross-section around the axis proportionally to position along that axis.
 * At bottom -> 0 degrees, at top -> angle degrees.
 */
export function applyTwist(
  positions: Float32Array,
  _normals: Float32Array,
  params: TwistParams
): void {
  const { angle, axis } = params;
  if (Math.abs(angle) < 1e-6) return;

  const angleRad = angle * (Math.PI / 180);
  const axisMap = { x: 0, y: 1, z: 2 } as const;
  const primary = axisMap[axis];
  const cross1 = (primary + 1) % 3;
  const cross2 = (primary + 2) % 3;

  // Find extent along primary axis
  let minP = Infinity, maxP = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const v = positions[i + primary];
    if (v < minP) minP = v;
    if (v > maxP) maxP = v;
  }
  const extent = maxP - minP;
  if (extent < 1e-6) return;

  for (let i = 0; i < positions.length; i += 3) {
    const p = positions[i + primary];
    const t = (p - minP) / extent;
    const theta = t * angleRad;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    const a = positions[i + cross1];
    const b = positions[i + cross2];

    // 2D rotation in cross-section plane
    positions[i + cross1] = a * cosT - b * sinT;
    positions[i + cross2] = a * sinT + b * cosT;
  }
}
