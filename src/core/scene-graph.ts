import * as THREE from 'three';
import {
  Transform,
  DEFAULT_TRANSFORM,
  PrimitiveType,
  MaterialData,
  DEFAULT_MATERIAL,
  DeformerType,
} from '../types';

export interface DeformerConfig {
  type: DeformerType;
  [key: string]: any;
}

export class SceneNode {
  id: string;
  type: PrimitiveType;
  transform: Transform;
  params: Record<string, number>;
  deformers: DeformerConfig[];
  material: MaterialData;
  parent: SceneNode | null;
  children: SceneNode[];
  mesh: THREE.Mesh | null;

  constructor(
    id: string,
    type: PrimitiveType,
    transform?: Partial<Transform>,
    params?: Record<string, number>,
    material?: MaterialData
  ) {
    this.id = id;
    this.type = type;
    this.transform = {
      position: transform?.position ?? [...DEFAULT_TRANSFORM.position],
      rotation: transform?.rotation ?? [...DEFAULT_TRANSFORM.rotation],
      scale: transform?.scale ?? [...DEFAULT_TRANSFORM.scale],
    };
    this.params = params ?? {};
    this.deformers = [];
    this.material = material ?? { ...DEFAULT_MATERIAL };
    this.parent = null;
    this.children = [];
    this.mesh = null;
  }
}

type SceneEventType = 'node:added' | 'node:removed' | 'node:updated';
type SceneEventHandler = (data: any) => void;

export class SceneGraph {
  private nodes: Map<string, SceneNode> = new Map();
  private root: SceneNode;
  private listeners: Map<SceneEventType, SceneEventHandler[]> = new Map();

  constructor() {
    // Virtual root node - not included in getAllNodes
    this.root = new SceneNode('__root__', 'box');
  }

  addNode(node: SceneNode): void {
    this.nodes.set(node.id, node);
    node.parent = this.root;
    this.root.children.push(node);
    this.emit('node:added', { node });
  }

  removeNode(id: string): SceneNode | undefined {
    const node = this.nodes.get(id);
    if (!node) return undefined;

    // Remove from parent's children
    const parent = node.parent;
    if (parent) {
      const idx = parent.children.indexOf(node);
      if (idx !== -1) parent.children.splice(idx, 1);
    }
    node.parent = null;

    // Remove all children recursively
    for (const child of [...node.children]) {
      this.removeNode(child.id);
    }

    this.nodes.delete(id);
    this.emit('node:removed', { node });
    return node;
  }

  getNode(id: string): SceneNode | undefined {
    return this.nodes.get(id);
  }

  reparent(nodeId: string, newParentId: string | null): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    const newParent = newParentId ? this.nodes.get(newParentId) : this.root;
    if (!newParent) return;

    // Remove from old parent
    const oldParent = node.parent;
    if (oldParent) {
      const idx = oldParent.children.indexOf(node);
      if (idx !== -1) oldParent.children.splice(idx, 1);
    }

    // Add to new parent
    node.parent = newParent;
    newParent.children.push(node);
    this.emit('node:updated', { node, change: 'reparent' });
  }

  traverse(fn: (node: SceneNode) => void): void {
    const visit = (node: SceneNode) => {
      for (const child of node.children) {
        fn(child);
        visit(child);
      }
    };
    visit(this.root);
  }

  getAllNodes(): SceneNode[] {
    return Array.from(this.nodes.values());
  }

  getRoot(): SceneNode {
    return this.root;
  }

  clear(): void {
    for (const node of this.getAllNodes()) {
      this.removeNode(node.id);
    }
  }

  on(event: SceneEventType, handler: SceneEventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  emit(event: SceneEventType, data: any): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }
}
