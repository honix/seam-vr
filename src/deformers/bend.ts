import type { BendParams } from './deformer-types';

/**
 * Apply bend deformation to vertex positions in place.
 * Rotates vertices around the bend axis proportionally to their position along it.
 */
export function applyBend(
  positions: Float32Array,
  _normals: Float32Array,
  params: BendParams
): void {
  const { angle, axis, center = 0 } = params;
  if (Math.abs(angle) < 1e-6) return;

  const angleRad = angle * (Math.PI / 180);

  // Axis indices: primary axis (along which bend varies), and the two cross axes
  const axisMap = { x: 0, y: 1, z: 2 } as const;
  const primary = axisMap[axis];

  // Bend plane: primary axis + one perpendicular axis
  // For y-axis bend, we bend in the y-z plane (z shifts toward y)
  // For x-axis bend, we bend in the x-z plane
  // For z-axis bend, we bend in the z-y plane
  const bendPlane: [number, number] = (() => {
    switch (axis) {
      case 'x': return [0, 2]; // bend along x, displace z
      case 'y': return [1, 2]; // bend along y, displace z
      case 'z': return [2, 1]; // bend along z, displace y
    }
  })();
  const [pIdx, sIdx] = bendPlane;

  // Find extent along primary axis for normalization
  let minP = Infinity, maxP = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const v = positions[i + pIdx];
    if (v < minP) minP = v;
    if (v > maxP) maxP = v;
  }
  const extent = maxP - minP;
  if (extent < 1e-6) return;

  for (let i = 0; i < positions.length; i += 3) {
    const p = positions[i + pIdx]; // position along primary axis
    const s = positions[i + sIdx]; // position along secondary axis

    // Normalized position along the axis relative to center
    const t = (p - center) / extent;
    const theta = t * angleRad;

    // If angle is very small, the bend radius is very large
    // Bend radius R = extent / angleRad
    const R = extent / angleRad;

    // Apply circular bend: the vertex moves along a circular arc
    // Offset from center along primary axis
    const dp = p - center;
    const bendAngle = dp / R;

    const cosA = Math.cos(bendAngle);
    const sinA = Math.sin(bendAngle);

    // New position: rotate (dp, s) around the bend center
    // The vertex at distance dp along primary and s along secondary
    // maps to a point on a circle of radius (R + s)
    const r = R + s;
    positions[i + pIdx] = center + r * sinA;
    positions[i + sIdx] = r * cosA - R;
  }
}
