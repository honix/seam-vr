// Selection outline - inverted hull technique for highlighting selected objects

import * as THREE from 'three';
import type { SceneNode } from '../core/scene-graph';

const OUTLINE_COLOR = 0xff8800;
const OUTLINE_SCALE = 1.04;

export class SelectionOutline {
  private outlineMesh: THREE.Mesh | null = null;
  private boxHelper: THREE.BoxHelper | null = null;
  private outlineMaterial: THREE.MeshBasicMaterial;

  constructor() {
    this.outlineMaterial = new THREE.MeshBasicMaterial({
      color: OUTLINE_COLOR,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
  }

  /**
   * Show outline on a scene node's mesh (primitives, lights).
   * Uses inverted hull: clone geometry, render back faces only, scale up slightly.
   */
  setTarget(node: SceneNode): void {
    this.clear();
    if (!node.mesh) return;

    const geo = node.mesh.geometry.clone();
    this.outlineMesh = new THREE.Mesh(geo, this.outlineMaterial);
    this.outlineMesh.scale.setScalar(OUTLINE_SCALE);
    this.outlineMesh.renderOrder = 999;
    node.mesh.add(this.outlineMesh);
  }

  /**
   * Show box wireframe around a group (for sculpt volume).
   */
  setTargetGroup(group: THREE.Group): void {
    this.clear();
    this.boxHelper = new THREE.BoxHelper(group, OUTLINE_COLOR);
    if (group.parent) {
      group.parent.add(this.boxHelper);
    }
  }

  clear(): void {
    if (this.outlineMesh) {
      this.outlineMesh.removeFromParent();
      this.outlineMesh.geometry.dispose();
      this.outlineMesh = null;
    }
    if (this.boxHelper) {
      this.boxHelper.removeFromParent();
      this.boxHelper.dispose();
      this.boxHelper = null;
    }
  }

  /** Update box helper bounds (call each frame if sculpt volume changes). */
  update(): void {
    if (this.boxHelper) {
      this.boxHelper.update();
    }
  }

  dispose(): void {
    this.clear();
    this.outlineMaterial.dispose();
  }
}
