import * as THREE from 'three';
import { TorusParams } from './primitive-params';

export function createTorusGeometry(params: TorusParams): THREE.BufferGeometry {
  return new THREE.TorusGeometry(
    params.radius,
    params.tubeRadius,
    params.radialSegments,
    params.tubularSegments
  );
}
