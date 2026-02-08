import * as THREE from 'three';
import { BoxParams } from './primitive-params';

export function createBoxGeometry(params: BoxParams): THREE.BufferGeometry {
  return new THREE.BoxGeometry(
    params.width,
    params.height,
    params.depth,
    params.widthSegments,
    params.heightSegments,
    params.depthSegments
  );
}
