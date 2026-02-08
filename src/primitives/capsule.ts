import * as THREE from 'three';
import { CapsuleParams } from './primitive-params';

export function createCapsuleGeometry(params: CapsuleParams): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(
    params.radius,
    params.length,
    params.capSegments,
    params.radialSegments
  );
}
