import * as THREE from 'three';
import { SceneGraph, SceneNode } from './scene-graph';

export class SceneAnchorManager {
  private sceneGraph: SceneGraph;
  private worldGroup: THREE.Object3D;

  constructor(sceneGraph: SceneGraph, worldGroup: THREE.Object3D) {
    this.sceneGraph = sceneGraph;
    this.worldGroup = worldGroup;

    this.sceneGraph.on('node:added', ({ node }) => {
      this.attachNode(node);
    });

    this.sceneGraph.on('node:removed', ({ node }) => {
      this.detachNode(node);
    });

    this.sceneGraph.on('node:updated', ({ node, change }) => {
      if (change === 'reparent') {
        this.reparentNode(node);
      }
    });
  }

  syncAll(): void {
    for (const node of this.sceneGraph.getAllNodes()) {
      this.attachNode(node);
    }
  }

  private attachNode(node: SceneNode): void {
    const anchor = node.object3D ?? node.mesh;
    if (!anchor || anchor.parent) return;

    const parentAnchor = this.getParentAnchor(node);
    parentAnchor.add(anchor);
  }

  private detachNode(node: SceneNode): void {
    const anchor = node.object3D ?? node.mesh;
    anchor?.removeFromParent();
  }

  private reparentNode(node: SceneNode): void {
    const anchor = node.object3D ?? node.mesh;
    if (!anchor) return;

    const parentAnchor = this.getParentAnchor(node);
    if (anchor.parent === parentAnchor) return;
    parentAnchor.attach(anchor);
  }

  private getParentAnchor(node: SceneNode): THREE.Object3D {
    const parent = node.parent;
    if (!parent || parent.id === '__root__') {
      return this.worldGroup;
    }
    return parent.object3D ?? parent.mesh ?? this.worldGroup;
  }
}
