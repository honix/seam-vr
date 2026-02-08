import * as THREE from 'three';
import { SphereParams } from './primitive-params';

export function createSphereGeometry(params: SphereParams): THREE.BufferGeometry {
  return new THREE.SphereGeometry(
    params.radius,
    params.widthSegments,
    params.heightSegments
  );
}
