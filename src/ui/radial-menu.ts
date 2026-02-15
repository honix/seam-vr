// Radial tool selection menu.
// Hold Y/B to open; release to select tool under pointer.
// 11 items in a circle, grouped by category, with text labels and colored discs.

import * as THREE from 'three';
import {
  ToolSystem,
  ToolId,
  TOOL_REGISTRY,
  ToolDefinition,
} from '../interaction/tool-system';
import { createTextTexture } from './canvas-text';
import type { Vec3 } from '../types';

const MENU_RADIUS = 0.12;
const DISC_RADIUS = 0.022;
const ACTIVE_RING_RADIUS = 0.026;
const SELECT_THRESHOLD = 0.06;

interface MenuItem {
  def: ToolDefinition;
  discMesh: THREE.Mesh;
  labelMesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
  angle: number;
}

export class RadialMenu {
  private scene: THREE.Scene;
  private toolSystem: ToolSystem;
  private hand: 'left' | 'right';

  private group: THREE.Group = new THREE.Group();
  private items: MenuItem[] = [];
  private highlightedIndex = -1;

  isOpen = false;

  constructor(scene: THREE.Scene, toolSystem: ToolSystem, hand: 'left' | 'right') {
    this.scene = scene;
    this.toolSystem = toolSystem;
    this.hand = hand;

    this.group.visible = false;
    this.scene.add(this.group);
    this.buildItems();
  }

  private buildItems(): void {
    const count = TOOL_REGISTRY.length;
    for (let i = 0; i < count; i++) {
      const def = TOOL_REGISTRY[i];
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * MENU_RADIUS;
      const y = Math.sin(angle) * MENU_RADIUS;

      // Background disc
      const discGeo = new THREE.CircleGeometry(DISC_RADIUS, 16);
      const discMat = new THREE.MeshBasicMaterial({
        color: def.color,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const discMesh = new THREE.Mesh(discGeo, discMat);
      discMesh.position.set(x, y, 0);
      this.group.add(discMesh);

      // Text label
      const labelTex = createTextTexture(def.label, {
        fontSize: 28,
        color: '#ffffff',
        width: 128,
        height: 32,
      });
      const labelMat = new THREE.MeshBasicMaterial({
        map: labelTex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const labelGeo = new THREE.PlaneGeometry(0.04, 0.01);
      const labelMesh = new THREE.Mesh(labelGeo, labelMat);
      labelMesh.position.set(x, y - DISC_RADIUS - 0.008, 0.001);
      this.group.add(labelMesh);

      // Active tool ring (only visible when this tool is active on this hand)
      const ringGeo = new THREE.RingGeometry(DISC_RADIUS + 0.002, ACTIVE_RING_RADIUS, 24);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.set(x, y, 0.001);
      ringMesh.visible = false;
      this.group.add(ringMesh);

      this.items.push({ def, discMesh, labelMesh, ringMesh, angle });
    }
  }

  open(position: Vec3, cameraPosition?: Vec3): void {
    this.group.position.set(position[0], position[1], position[2]);
    this.group.visible = true;
    this.isOpen = true;
    this.highlightedIndex = -1;
    this.resetHighlights();
    this.updateActiveRings();

    // Billboard toward camera
    if (cameraPosition) {
      this.group.lookAt(cameraPosition[0], cameraPosition[1], cameraPosition[2]);
    }
  }

  close(): ToolId | null {
    this.group.visible = false;
    this.isOpen = false;
    const selected = this.highlightedIndex >= 0 ? this.items[this.highlightedIndex].def.id : null;
    this.highlightedIndex = -1;
    this.resetHighlights();
    return selected;
  }

  /**
   * Update highlighting based on pointer position. Call each frame while open.
   */
  updatePointer(pointerPosition: Vec3): void {
    if (!this.isOpen) return;

    const pointer = new THREE.Vector3(...pointerPosition);
    const groupPos = this.group.position;
    // Transform pointer to local space (accounting for group rotation)
    const localPointer = pointer.clone().sub(groupPos);
    this.group.worldToLocal(localPointer.add(groupPos));
    localPointer.sub(groupPos);

    // Actually, simpler approach: project into the menu plane
    const menuWorldMatrix = this.group.matrixWorld;
    const invMatrix = menuWorldMatrix.clone().invert();
    const localPt = pointer.clone().applyMatrix4(invMatrix);

    let closestIdx = -1;
    let closestDist = SELECT_THRESHOLD;

    for (let i = 0; i < this.items.length; i++) {
      const itemPos = this.items[i].discMesh.position;
      const dx = localPt.x - itemPos.x;
      const dy = localPt.y - itemPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }

    if (closestIdx !== this.highlightedIndex) {
      this.resetHighlights();
      this.highlightedIndex = closestIdx;
      if (closestIdx >= 0) {
        const mat = this.items[closestIdx].discMesh.material as THREE.MeshBasicMaterial;
        mat.opacity = 1.0;
        // Scale up slightly for visual feedback
        this.items[closestIdx].discMesh.scale.setScalar(1.3);
      }
    }
  }

  private updateActiveRings(): void {
    const activeTool = this.toolSystem.getTool(this.hand);
    for (const item of this.items) {
      item.ringMesh.visible = item.def.id === activeTool;
    }
  }

  private resetHighlights(): void {
    for (const item of this.items) {
      const mat = item.discMesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.7;
      item.discMesh.scale.setScalar(1.0);
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const item of this.items) {
      item.discMesh.geometry.dispose();
      (item.discMesh.material as THREE.Material).dispose();
      item.labelMesh.geometry.dispose();
      (item.labelMesh.material as THREE.MeshBasicMaterial).map?.dispose();
      (item.labelMesh.material as THREE.Material).dispose();
      item.ringMesh.geometry.dispose();
      (item.ringMesh.material as THREE.Material).dispose();
    }
  }
}
