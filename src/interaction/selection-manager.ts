// Selection system - raycasting + selection state management

import * as THREE from 'three';
import { SceneGraph, SceneNode } from '../core/scene-graph';
import type { SculptEngine } from '../sculpting/sculpt-engine';
import type { Vec3 } from '../types';

export class SelectionManager {
  selectedNodeId: string | null = null;
  private sceneGraph: SceneGraph;
  private worldGroup: THREE.Object3D;
  private sculptEngine: SculptEngine | null = null;
  private callbacks: Array<(nodeId: string | null, node: SceneNode | null) => void> = [];

  constructor(sceneGraph: SceneGraph, worldGroup: THREE.Object3D) {
    this.sceneGraph = sceneGraph;
    this.worldGroup = worldGroup;
  }

  setSculptEngine(engine: SculptEngine): void {
    this.sculptEngine = engine;
  }

  /**
   * Cast a ray and select the closest intersected scene node.
   * Tests all nodes with meshes (primitives, lights) and sculpt volume chunks.
   */
  raySelect(origin: Vec3, direction: Vec3): void {
    const raycaster = new THREE.Raycaster();
    raycaster.set(
      new THREE.Vector3(origin[0], origin[1], origin[2]),
      new THREE.Vector3(direction[0], direction[1], direction[2]).normalize()
    );

    // Intersect all children of worldGroup recursively
    const intersects = raycaster.intersectObjects([this.worldGroup], true);

    if (intersects.length === 0) {
      this.selectById(null);
      return;
    }

    // Map the intersected mesh back to a scene node
    for (const hit of intersects) {
      const nodeId = this.meshToNodeId(hit.object);
      if (nodeId !== null) {
        this.selectById(nodeId);
        return;
      }
    }

    // No match found
    this.selectById(null);
  }

  /**
   * Map a Three.js object back to a scene node ID.
   * Walks up the parent chain to find a match.
   */
  private meshToNodeId(object: THREE.Object3D): string | null {
    // Check sculpt volume first: any child of sculptGroup maps to 'sculpt_volume'
    if (this.sculptEngine) {
      let current: THREE.Object3D | null = object;
      while (current) {
        if (current === this.sculptEngine.sculptGroup) {
          return 'sculpt_volume';
        }
        current = current.parent;
      }
    }

    // Check scene graph nodes
    const allNodes = this.sceneGraph.getAllNodes();
    for (const node of allNodes) {
      if (!node.mesh) continue;
      // Check if the hit object IS the node's mesh or is a child of it
      let current: THREE.Object3D | null = object;
      while (current) {
        if (current === node.mesh) {
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
