import * as THREE from 'three';

/**
 * Set up scene environment lighting.
 * Creates directional, ambient, and hemisphere lights.
 */
export function setupEnvironment(scene: THREE.Scene): void {
  // Main directional light
  const directional = new THREE.DirectionalLight(0xffffff, 1.0);
  directional.position.set(5, 10, 7);
  directional.name = 'seam_directional';
  scene.add(directional);

  // Ambient fill
  const ambient = new THREE.AmbientLight(0x404060, 0.5);
  ambient.name = 'seam_ambient';
  scene.add(ambient);

  // Hemisphere light for sky/ground color variation
  const hemisphere = new THREE.HemisphereLight(0x88aacc, 0x442211, 0.3);
  hemisphere.name = 'seam_hemisphere';
  scene.add(hemisphere);
}

/**
 * Create a ground grid for spatial reference.
 */
export function createGroundGrid(scene: THREE.Scene): THREE.GridHelper {
  const grid = new THREE.GridHelper(10, 10, 0x444466, 0x333355);
  grid.name = 'seam_grid';
  scene.add(grid);
  return grid;
}
