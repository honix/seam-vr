import * as THREE from 'three';
import { Vec3 } from '../types';
import { SceneGraph, SceneNode } from '../core/scene-graph';
import { CommandBus } from '../core/command-bus';

interface HandleInfo {
  mesh: THREE.Mesh;
  axis: 'x' | 'y' | 'z';
  axisIndex: 0 | 1 | 2; // index into scale Vec3
  direction: THREE.Vector3;
}

interface DragState {
  handle: HandleInfo;
  nodeId: string;
  startPosition: THREE.Vector3;
  initialScale: Vec3;
}

const HANDLE_RADIUS = 0.020;
const HANDLE_DISTANCE = 0.20;
const GRAB_THRESHOLD = 0.06; // proximity grab for handles too

const AXIS_COLORS = {
  x: 0xff4444,
  y: 0x44ff44,
  z: 0x4444ff,
};

export class HandleSystem {
  private scene: THREE.Scene;
  private sceneGraph: SceneGraph;
  private commandBus: CommandBus;

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

    const handleGeo = new THREE.SphereGeometry(HANDLE_RADIUS, 8, 8);

    const axes: Array<{ axis: 'x' | 'y' | 'z'; axisIndex: 0 | 1 | 2; dir: THREE.Vector3 }> = [
      { axis: 'x', axisIndex: 0, dir: new THREE.Vector3(1, 0, 0) },
      { axis: 'y', axisIndex: 1, dir: new THREE.Vector3(0, 1, 0) },
      { axis: 'z', axisIndex: 2, dir: new THREE.Vector3(0, 0, 1) },
    ];

    for (const { axis, axisIndex, dir } of axes) {
      // Positive direction handle
      const mat = new THREE.MeshBasicMaterial({ color: AXIS_COLORS[axis] });
      const mesh = new THREE.Mesh(handleGeo.clone(), mat);
      mesh.position.copy(dir.clone().multiplyScalar(HANDLE_DISTANCE));
      this.handleGroup.add(mesh);

      this.handles.push({ mesh, axis, axisIndex, direction: dir.clone() });

      // Negative direction handle (semi-transparent)
      const matNeg = new THREE.MeshBasicMaterial({
        color: AXIS_COLORS[axis],
        opacity: 0.5,
        transparent: true,
      });
      const meshNeg = new THREE.Mesh(handleGeo.clone(), matNeg);
      meshNeg.position.copy(dir.clone().multiplyScalar(-HANDLE_DISTANCE));
      this.handleGroup.add(meshNeg);

      this.handles.push({ mesh: meshNeg, axis, axisIndex, direction: dir.clone().negate() });
    }

    // Position handle group at the node's position
    const pos = node.transform.position;
    this.handleGroup.position.set(pos[0], pos[1], pos[2]);
    this.handleGroup.visible = true;
  }

  hideHandles(): void {
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

  tryGrabHandle(position: Vec3, _direction: Vec3): boolean {
    if (this.handles.length === 0 || !this.activeNodeId) return false;

    const handPos = new THREE.Vector3(...position);

    // Find closest handle within grab threshold (proximity-based)
    let closestHandle: HandleInfo | null = null;
    let closestDist = GRAB_THRESHOLD;

    for (const handle of this.handles) {
      // Get world position of handle
      const worldPos = new THREE.Vector3();
      handle.mesh.getWorldPosition(worldPos);
      const dist = handPos.distanceTo(worldPos);
      if (dist < closestDist) {
        closestDist = dist;
        closestHandle = handle;
      }
    }

    if (!closestHandle) return false;

    const node = this.sceneGraph.getNode(this.activeNodeId);
    if (!node) return false;

    this.dragState = {
      handle: closestHandle,
      nodeId: this.activeNodeId,
      startPosition: handPos.clone(),
      initialScale: [...node.transform.scale],
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

    // Map drag distance to scale change (sensitivity tuned for small primitives)
    const sensitivity = 5.0;
    const idx = this.dragState.handle.axisIndex;
    const newScale = Math.max(0.01, this.dragState.initialScale[idx] + axisDelta * sensitivity);

    // Update transform scale
    node.transform.scale[idx] = newScale;

    // Update mesh immediately for visual feedback
    if (node.mesh) {
      node.mesh.scale.set(
        node.transform.scale[0],
        node.transform.scale[1],
        node.transform.scale[2]
      );
    }
  }

  releaseHandle(): void {
    if (!this.dragState) return;

    const node = this.sceneGraph.getNode(this.dragState.nodeId);
    if (node) {
      // Commit scale change via command bus for undo support
      this.commandBus.exec({
        cmd: 'set_transform',
        id: this.dragState.nodeId,
        scale: [...node.transform.scale],
      });
    }

    this.dragState = null;
  }

  updatePosition(): void {
    if (!this.activeNodeId) return;
    const node = this.sceneGraph.getNode(this.activeNodeId);
    if (!node) return;
    const pos = node.transform.position;
    this.handleGroup.position.set(pos[0], pos[1], pos[2]);
  }

  get isActive(): boolean {
    return this.activeNodeId !== null;
  }

  get isDragging(): boolean {
    return this.dragState !== null;
  }
}
