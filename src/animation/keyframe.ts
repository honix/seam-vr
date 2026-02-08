import { Vec3, Vec4, InterpolationMode } from '../types';

export interface Keyframe {
  time: number;
  value: number | Vec3 | Vec4;
  interpolation: InterpolationMode;
}

// Scalar interpolation
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Vec3 interpolation
export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
}

// Quaternion spherical linear interpolation
export function slerp(a: Vec4, b: Vec4, t: number): Vec4 {
  // Compute dot product
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

  // If negative dot, negate one quaternion to take shorter path
  let b2: Vec4 = [...b];
  if (dot < 0) {
    dot = -dot;
    b2 = [-b[0], -b[1], -b[2], -b[3]];
  }

  // If very close, use linear interpolation to avoid division by zero
  if (dot > 0.9995) {
    const result: Vec4 = [
      lerp(a[0], b2[0], t),
      lerp(a[1], b2[1], t),
      lerp(a[2], b2[2], t),
      lerp(a[3], b2[3], t),
    ];
    // Normalize
    const len = Math.sqrt(
      result[0] * result[0] + result[1] * result[1] +
      result[2] * result[2] + result[3] * result[3]
    );
    return [result[0] / len, result[1] / len, result[2] / len, result[3] / len];
  }

  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;

  return [
    wa * a[0] + wb * b2[0],
    wa * a[1] + wb * b2[1],
    wa * a[2] + wb * b2[2],
    wa * a[3] + wb * b2[3],
  ];
}

// Easing functions
export function easeIn(t: number): number {
  return t * t;
}

export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function easeInOut(t: number): number {
  // Smooth step: 3t^2 - 2t^3
  return t * t * (3 - 2 * t);
}

export function applyEasing(t: number, mode: InterpolationMode): number {
  switch (mode) {
    case 'linear':
      return t;
    case 'ease-in':
      return easeIn(t);
    case 'ease-out':
      return easeOut(t);
    case 'ease-in-out':
      return easeInOut(t);
    case 'step':
      return t < 1 ? 0 : 1;
    default:
      return t;
  }
}
