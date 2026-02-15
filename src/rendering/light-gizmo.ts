// Light gizmo - directional arrow for directional and spot lights

import * as THREE from 'three';
import type { SceneNode } from '../core/scene-graph';

const ARROW_LENGTH = 0.15;
const ARROW_HEAD_LENGTH = 0.04;
const ARROW_HEAD_WIDTH = 0.02;

export class LightGizmo {
  private arrow: THREE.ArrowHelper;
  private visible = false;

  constructor() {
    // Arrow pointing in local -Z direction (forward)
    const dir = new THREE.Vector3(0, 0, -1);
    const origin = new THREE.Vector3(0, 0, 0);
    this.arrow = new THREE.ArrowHelper(
      dir,
      origin,
      ARROW_LENGTH,
      0xffffff,
      ARROW_HEAD_LENGTH,
      ARROW_HEAD_WIDTH
    );
    this.arrow.visible = false;
  }

  /**
   * Show gizmo for directional/spot lights, hide for point lights.
   */
  setTarget(node: SceneNode): void {
    this.clear();
    if (!node.lightData || !node.mesh) return;

    const type = node.lightData.type;
    if (type === 'directional' || type === 'spot') {
      // Set arrow color to match light
      const c = node.lightData.color;
      const color = new THREE.Color(c[0], c[1], c[2]);
      this.arrow.setColor(color);

      // Parent arrow to the light's visual mesh
      node.mesh.add(this.arrow);
      this.arrow.visible = true;
      this.visible = true;
    }
  }

  clear(): void {
    this.arrow.visible = false;
    this.arrow.removeFromParent();
    this.visible = false;
  }

  dispose(): void {
    this.clear();
    // ArrowHelper disposes its own geometry/material
    this.arrow.dispose();
  }
}
