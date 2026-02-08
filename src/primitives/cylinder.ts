import * as THREE from 'three';
import { CylinderParams } from './primitive-params';

export function createCylinderGeometry(params: CylinderParams): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(
    params.radiusTop,
    params.radiusBottom,
    params.height,
    params.radialSegments,
    params.heightSegments
  );
}
