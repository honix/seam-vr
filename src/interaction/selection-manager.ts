// Selection system - raycasting + selection state management.

import * as THREE from 'three';
import { SceneGraph, SceneNode } from '../core/scene-graph';
import type { Vec3 } from '../types';

export class SelectionManager {
  selectedNodeId: string | null = null;
  private sceneGraph: SceneGraph;
  private worldGroup: THREE.Object3D;
  private callbacks: Array<(nodeId: string | null, node: SceneNode | null) => void> = [];

  constructor(sceneGraph: SceneGraph, worldGroup: THREE.Object3D) {
    this.sceneGraph = sceneGraph;
    this.worldGroup = worldGroup;
  }

  raySelect(origin: Vec3, direction: Vec3): void {
    const raycaster = new THREE.Raycaster();
    raycaster.set(
      new THREE.Vector3(origin[0], origin[1], origin[2]),
      new THREE.Vector3(direction[0], direction[1], direction[2]).normalize()
    );

    const intersects = raycaster.intersectObjects([this.worldGroup], true);
    if (intersects.length === 0) {
      this.selectById(null);
      return;
    }

    for (const hit of intersects) {
      const nodeId = this.objectToNodeId(hit.object);
      if (nodeId !== null) {
        this.selectById(nodeId);
        return;
      }
    }

    this.selectById(null);
  }

  private objectToNodeId(object: THREE.Object3D): string | null {
    const allNodes = this.sceneGraph.getAllNodes();
    for (const node of allNodes) {
      const anchor = node.object3D ?? node.mesh;
      if (!anchor) continue;

      let current: THREE.Object3D | null = object;
      while (current) {
        if (current === anchor) {
          return node.id;
        }
        current = current.parent;
      }
    }

    return null;
  }

  selectById(nodeId: string | null): void {
    if (this.selectedNodeId === nodeId) return;
    this.selectedNodeId = nodeId;
    const node = nodeId ? (this.sceneGraph.getNode(nodeId) ?? null) : null;
    for (const cb of this.callbacks) {
      cb(nodeId, node);
    }
  }

  onChange(cb: (nodeId: string | null, node: SceneNode | null) => void): void {
    this.callbacks.push(cb);
  }
}
