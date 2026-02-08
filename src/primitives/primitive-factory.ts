import * as THREE from 'three';
import { PrimitiveType } from '../types';
import { getDefaultParams } from './primitive-params';
import { createCylinderGeometry } from './cylinder';
import { createSphereGeometry } from './sphere';
import { createBoxGeometry } from './box';
import { createConeGeometry } from './cone';
import { createTorusGeometry } from './torus';
import { createCapsuleGeometry } from './capsule';
import { createTubeGeometry } from './tube';

export function createPrimitiveGeometry(
  type: PrimitiveType,
  params: Record<string, any>
): THREE.BufferGeometry {
  const defaults = getDefaultParams(type);
  const merged = { ...defaults, ...params };

  switch (type) {
    case 'cylinder':
      return createCylinderGeometry(merged as any);
    case 'sphere':
      return createSphereGeometry(merged as any);
    case 'box':
      return createBoxGeometry(merged as any);
    case 'cone':
      return createConeGeometry(merged as any);
    case 'torus':
      return createTorusGeometry(merged as any);
    case 'capsule':
      return createCapsuleGeometry(merged as any);
    case 'tube':
      return createTubeGeometry(merged as any);
    default:
      throw new Error(`Unknown primitive type: ${type}`);
  }
}
