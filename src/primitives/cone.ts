import * as THREE from 'three';
import { ConeParams } from './primitive-params';

export function createConeGeometry(params: ConeParams): THREE.BufferGeometry {
  return new THREE.ConeGeometry(
    params.radius,
    params.height,
    params.radialSegments,
    params.heightSegments
  );
}
