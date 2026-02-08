import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Create and configure an orbit camera for flat-screen viewing.
 */
export function createOrbitCamera(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement
): OrbitControls {
  const controls = new OrbitControls(camera, domElement);

  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0.5, 0);
  controls.minDistance = 0.5;
  controls.maxDistance = 50;
  controls.maxPolarAngle = Math.PI * 0.95; // Prevent flipping under ground
  controls.update();

  return controls;
}

/**
 * Call in the render loop to update damping.
 */
export function updateOrbitCamera(controls: OrbitControls): void {
  controls.update();
}
