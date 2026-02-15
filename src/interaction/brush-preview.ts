// Visual brush sphere at controller tip.
// Semi-transparent sphere per hand, color-coded by active sculpt tool.

import * as THREE from 'three';
import { ToolSystem, isSculptTool, getToolDef, ToolId } from './tool-system';
import type { XRControllerState } from '../xr/xr-controller';

export class BrushPreview {
  private sphereL: THREE.Mesh;
  private sphereR: THREE.Mesh;
  private matL: THREE.MeshBasicMaterial;
  private matR: THREE.MeshBasicMaterial;
  private scene: THREE.Scene;
  private toolSystem: ToolSystem;

  constructor(scene: THREE.Scene, toolSystem: ToolSystem) {
    this.scene = scene;
    this.toolSystem = toolSystem;

    const geo = new THREE.SphereGeometry(1, 16, 12);

    this.matL = new THREE.MeshBasicMaterial({
      color: 0x44cc44,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
    this.matR = new THREE.MeshBasicMaterial({
      color: 0x44cc44,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });

    this.sphereL = new THREE.Mesh(geo.clone(), this.matL);
    this.sphereR = new THREE.Mesh(geo.clone(), this.matR);
    this.sphereL.visible = false;
    this.sphereR.visible = false;
    this.sphereL.name = 'brush_preview_left';
    this.sphereR.name = 'brush_preview_right';
    this.sphereL.renderOrder = 999;
    this.sphereR.renderOrder = 999;

    this.scene.add(this.sphereL);
    this.scene.add(this.sphereR);
  }

  update(left: XRControllerState, right: XRControllerState): void {
    this.updateHand('left', left, this.sphereL, this.matL);
    this.updateHand('right', right, this.sphereR, this.matR);
  }

  private updateHand(
    hand: 'left' | 'right',
    state: XRControllerState,
    sphere: THREE.Mesh,
    mat: THREE.MeshBasicMaterial,
  ): void {
    const toolId = this.toolSystem.getTool(hand);

    if (toolId === 'move_layer') {
      sphere.visible = true;
      mat.color.setHex(getToolDef('move_layer').color);
      sphere.scale.setScalar(0.2); // matches GRAB_RADIUS
      sphere.position.set(state.position[0], state.position[1], state.position[2]);
      return;
    }

    if (!isSculptTool(toolId)) {
      sphere.visible = false;
      return;
    }

    sphere.visible = true;
    const def = getToolDef(toolId);
    mat.color.setHex(def.color);

    const radius = this.toolSystem.getBrushRadius(hand);
    sphere.scale.setScalar(radius);
    sphere.position.set(state.position[0], state.position[1], state.position[2]);
  }

  dispose(): void {
    this.scene.remove(this.sphereL);
    this.scene.remove(this.sphereR);
    this.sphereL.geometry.dispose();
    this.sphereR.geometry.dispose();
    this.matL.dispose();
    this.matR.dispose();
  }
}
