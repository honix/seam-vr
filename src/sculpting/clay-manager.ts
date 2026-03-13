import * as THREE from 'three';
import { SceneGraph, SceneNode } from '../core/scene-graph';
import { SculptEngine } from './sculpt-engine';

export class ClayManager {
  private sceneGraph: SceneGraph;
  private worldGroup: THREE.Object3D;
  private engines = new Map<string, SculptEngine>();
  private initPromises = new Map<string, Promise<void>>();
  private activeClayId: string | null = null;

  constructor(sceneGraph: SceneGraph, worldGroup: THREE.Object3D) {
    this.sceneGraph = sceneGraph;
    this.worldGroup = worldGroup;

    this.sceneGraph.on('node:added', ({ node }) => {
      if (node.nodeType === 'clay') {
        this.ensureClay(node);
      }
    });

    this.sceneGraph.on('node:removed', ({ node }) => {
      if (node.nodeType === 'clay') {
        this.disposeClay(node.id);
      }
    });

    this.sceneGraph.on('node:updated', ({ node, change }) => {
      if (node.nodeType !== 'clay') return;
      if (change === 'material') {
        this.syncMaterial(node.id);
      }
      if (change === 'visibility') {
        const anchor = node.object3D ?? node.mesh;
        if (anchor) {
          anchor.visible = node.visible;
        }
      }
    });
  }

  async syncAll(): Promise<void> {
    const clayNodes = this.sceneGraph.getAllNodes().filter((node) => node.nodeType === 'clay');
    await Promise.all(clayNodes.map((node) => this.ensureClay(node)));
  }

  setActiveClay(nodeId: string | null): void {
    this.activeClayId = nodeId;
  }

  getActiveClayId(): string | null {
    return this.activeClayId;
  }

  getActiveEngine(): SculptEngine | null {
    if (!this.activeClayId) return null;
    return this.engines.get(this.activeClayId) ?? null;
  }

  getEngine(nodeId: string): SculptEngine | null {
    return this.engines.get(nodeId) ?? null;
  }

  toActiveClayLocalPosition(position: [number, number, number]): [number, number, number] | null {
    if (!this.activeClayId) return null;
    const node = this.sceneGraph.getNode(this.activeClayId);
    const anchor = node?.object3D ?? node?.mesh ?? null;
    if (!anchor) return null;

    anchor.updateWorldMatrix(true, false);
    const worldPosition = this.worldGroup.localToWorld(new THREE.Vector3(...position));
    const localPosition = anchor.worldToLocal(worldPosition);
    return [localPosition.x, localPosition.y, localPosition.z];
  }

  toActiveClayLocalRadius(radius: number): number {
    if (!this.activeClayId) return radius;
    const node = this.sceneGraph.getNode(this.activeClayId);
    const anchor = node?.object3D ?? node?.mesh ?? null;
    if (!anchor) return radius;

    const scale = new THREE.Vector3();
    anchor.getWorldScale(scale);
    const maxScale = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z), 0.0001);
    return radius / maxScale;
  }

  private ensureClay(node: SceneNode): Promise<void> {
    if (this.engines.has(node.id)) {
      return Promise.resolve();
    }
    const existing = this.initPromises.get(node.id);
    if (existing) return existing;

    const promise = this.initClay(node);
    this.initPromises.set(node.id, promise);
    return promise;
  }

  private async initClay(node: SceneNode): Promise<void> {
    if (!node.object3D) {
      node.object3D = new THREE.Group();
      node.object3D.name = `clay_${node.id}`;
      this.worldGroup.add(node.object3D);
    }

    const engine = new SculptEngine(node.object3D, undefined, `clay_mesh_${node.id}`);
    engine.applyMaterial(node.material);
    this.engines.set(node.id, engine);

    try {
      await engine.initGPU();
    } finally {
      this.initPromises.delete(node.id);
    }
  }

  private syncMaterial(nodeId: string): void {
    const node = this.sceneGraph.getNode(nodeId);
    const engine = this.engines.get(nodeId);
    if (!node || !engine) return;
    engine.applyMaterial(node.material);
  }

  private disposeClay(nodeId: string): void {
    const engine = this.engines.get(nodeId);
    if (engine) {
      engine.dispose();
      this.engines.delete(nodeId);
    }
    this.initPromises.delete(nodeId);
    if (this.activeClayId === nodeId) {
      this.activeClayId = null;
    }
  }

  dispose(): void {
    for (const engine of this.engines.values()) {
      engine.dispose();
    }
    this.engines.clear();
    this.initPromises.clear();
    this.activeClayId = null;
  }
}
