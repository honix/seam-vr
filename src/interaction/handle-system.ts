import * as THREE from 'three';
import { Vec3 } from '../types';
import { SceneGraph, SceneNode } from '../core/scene-graph';
import { CommandBus } from '../core/command-bus';

interface HandleInfo {
  mesh: THREE.Mesh;
  axis: 'x' | 'y' | 'z';
  param: string;
  direction: THREE.Vector3;
}

interface DragState {
  handle: HandleInfo;
  nodeId: string;
  startPosition: THREE.Vector3;
  initialValue: number;
}

const HANDLE_RADIUS = 0.02;
const HANDLE_DISTANCE = 0.3;

const AXIS_COLORS = {
  x: 0xff4444,
  y: 0x44ff44,
  z: 0x4444ff,
};

export class HandleSystem {
  private scene: THREE.Scene;
  private sceneGraph: SceneGraph;
  private commandBus: CommandBus;
  private raycaster = new THREE.Raycaster();

  private handles: HandleInfo[] = [];
  private handleGroup: THREE.Group = new THREE.Group();
  private activeNodeId: string | null = null;
  private dragState: DragState | null = null;

  constructor(scene: THREE.Scene, sceneGraph: SceneGraph, commandBus: CommandBus) {
    this.scene = scene;
    this.sceneGraph = sceneGraph;
    this.commandBus = commandBus;
    this.handleGroup.visible = false;
    this.scene.add(this.handleGroup);
  }

  showHandles(nodeId: string): void {
    const node = this.sceneGraph.getNode(nodeId);
    if (!node) return;

    this.hideHandles();
    this.activeNodeId = nodeId;

    // Create handles based on the primitive type's deformable axes
    const handleGeo = new THREE.SphereGeometry(HANDLE_RADIUS, 8, 8);

    const axes: Array<{ axis: 'x' | 'y' | 'z'; param: string; dir: THREE.Vector3 }> = [
      { axis: 'x', param: 'scaleX', dir: new THREE.Vector3(1, 0, 0) },
      { axis: 'y', param: 'scaleY', dir: new THREE.Vector3(0, 1, 0) },
      { axis: 'z', param: 'scaleZ', dir: new THREE.Vector3(0, 0, 1) },
    ];

    for (const { axis, param, dir } of axes) {
      // Positive direction handle
      const mat = new THREE.MeshBasicMaterial({ color: AXIS_COLORS[axis] });
      const mesh = new THREE.Mesh(handleGeo.clone(), mat);
      mesh.position.copy(dir.clone().multiplyScalar(HANDLE_DISTANCE));
      this.handleGroup.add(mesh);

      this.handles.push({
        mesh,
        axis,
        param,
        direction: dir.clone(),
      });

      // Negative direction handle
      const matNeg = new THREE.MeshBasicMaterial({
        color: AXIS_COLORS[axis],
        opacity: 0.5,
        transparent: true,
      });
      const meshNeg = new THREE.Mesh(handleGeo.clone(), matNeg);
      meshNeg.position.copy(dir.clone().multiplyScalar(-HANDLE_DISTANCE));
      this.handleGroup.add(meshNeg);

      this.handles.push({
        mesh: meshNeg,
        axis,
        param,
        direction: dir.clone().negate(),
      });
    }

    // Position handle group at the node's position
    const pos = node.transform.position;
    this.handleGroup.position.set(pos[0], pos[1], pos[2]);
    this.handleGroup.visible = true;
  }

  hideHandles(): void {
    // Remove all handle meshes
    while (this.handleGroup.children.length > 0) {
      const child = this.handleGroup.children[0];
      this.handleGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    this.handles = [];
    this.activeNodeId = null;
    this.handleGroup.visible = false;
  }

  tryGrabHandle(position: Vec3, direction: Vec3): boolean {
    if (this.handles.length === 0) return false;

    this.raycaster.set(
      new THREE.Vector3(...position),
      new THREE.Vector3(...direction).normalize()
    );

    const handleMeshes = this.handles.map((h) => h.mesh);
    const intersects = this.raycaster.intersectObjects(handleMeshes, false);

    if (intersects.length === 0) return false;

    const hitMesh = intersects[0].object as THREE.Mesh;
    const handle = this.handles.find((h) => h.mesh === hitMesh);
    if (!handle || !this.activeNodeId) return false;

    const node = this.sceneGraph.getNode(this.activeNodeId);
    if (!node) return false;

    this.dragState = {
      handle,
      nodeId: this.activeNodeId,
      startPosition: new THREE.Vector3(...position),
      initialValue: node.params[handle.param] ?? 1,
    };

    return true;
  }

  updateHandleDrag(position: Vec3): void {
    if (!this.dragState) return;

    const node = this.sceneGraph.getNode(this.dragState.nodeId);
    if (!node) {
      this.dragState = null;
      return;
    }

    const currentPos = new THREE.Vector3(...position);
    const delta = currentPos.clone().sub(this.dragState.startPosition);

    // Project delta onto the handle's axis direction
    const axisDelta = delta.dot(this.dragState.handle.direction);

    // Map axis delta to parameter change (scale sensitivity)
    const sensitivity = 2.0;
    const newValue = Math.max(0.01, this.dragState.initialValue + axisDelta * sensitivity);

    node.params[this.dragState.handle.param] = newValue;
  }

  releaseHandle(): void {
    if (!this.dragState) return;

    const node = this.sceneGraph.getNode(this.dragState.nodeId);
    if (node) {
      this.commandBus.exec({
        cmd: 'set_param',
        id: this.dragState.nodeId,
        key: this.dragState.handle.param,
        value: node.params[this.dragState.handle.param],
      });
    }

    this.dragState = null;
  }

  get isActive(): boolean {
    return this.activeNodeId !== null;
  }

  get isDragging(): boolean {
    return this.dragState !== null;
  }
}
