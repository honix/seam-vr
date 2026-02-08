import * as THREE from 'three';
import { Vec3, Vec4 } from '../types';
import { SceneGraph, SceneNode } from '../core/scene-graph';
import { CommandBus } from '../core/command-bus';

interface GrabState {
  nodeId: string;
  offsetPosition: THREE.Vector3;
  offsetQuaternion: THREE.Quaternion;
  initialTransformPos: Vec3;
  initialTransformRot: Vec4;
}

export class GrabSystem {
  private scene: THREE.Scene;
  private sceneGraph: SceneGraph;
  private commandBus: CommandBus;
  private raycaster = new THREE.Raycaster();

  private grabs: Map<string, GrabState> = new Map(); // hand -> grab state

  constructor(scene: THREE.Scene, sceneGraph: SceneGraph, commandBus: CommandBus) {
    this.scene = scene;
    this.sceneGraph = sceneGraph;
    this.commandBus = commandBus;
  }

  tryGrab(hand: 'left' | 'right', position: Vec3, direction: Vec3): boolean {
    // Set up raycaster
    this.raycaster.set(
      new THREE.Vector3(...position),
      new THREE.Vector3(...direction).normalize()
    );

    // Collect all meshes from scene nodes
    const meshes: THREE.Mesh[] = [];
    const meshToNode: Map<THREE.Mesh, SceneNode> = new Map();

    this.sceneGraph.traverse((node) => {
      if (node.mesh) {
        meshes.push(node.mesh);
        meshToNode.set(node.mesh, node);
      }
    });

    if (meshes.length === 0) return false;

    const intersects = this.raycaster.intersectObjects(meshes, false);
    if (intersects.length === 0) return false;

    const hitMesh = intersects[0].object as THREE.Mesh;
    const node = meshToNode.get(hitMesh);
    if (!node) return false;

    // Compute offset: hand position/rotation relative to the primitive
    const handPos = new THREE.Vector3(...position);
    const meshPos = new THREE.Vector3(...node.transform.position);
    const offsetPos = meshPos.clone().sub(handPos);

    const handQuat = new THREE.Quaternion(); // identity for now
    const meshQuat = new THREE.Quaternion(...node.transform.rotation);
    const offsetQuat = handQuat.clone().invert().multiply(meshQuat);

    this.grabs.set(hand, {
      nodeId: node.id,
      offsetPosition: offsetPos,
      offsetQuaternion: offsetQuat,
      initialTransformPos: [...node.transform.position],
      initialTransformRot: [...node.transform.rotation],
    });

    return true;
  }

  updateGrab(hand: 'left' | 'right', position: Vec3, rotation: Vec4): void {
    const grab = this.grabs.get(hand);
    if (!grab) return;

    const node = this.sceneGraph.getNode(grab.nodeId);
    if (!node) {
      this.grabs.delete(hand);
      return;
    }

    // New position = hand position + offset
    const handPos = new THREE.Vector3(...position);
    const newPos = handPos.clone().add(grab.offsetPosition);
    node.transform.position = [newPos.x, newPos.y, newPos.z];

    // New rotation = hand rotation * offset rotation
    const handQuat = new THREE.Quaternion(...rotation);
    const newQuat = handQuat.clone().multiply(grab.offsetQuaternion);
    node.transform.rotation = [newQuat.x, newQuat.y, newQuat.z, newQuat.w];

    // Update mesh transform
    if (node.mesh) {
      node.mesh.position.copy(newPos);
      node.mesh.quaternion.copy(newQuat);
    }
  }

  release(hand: 'left' | 'right'): void {
    const grab = this.grabs.get(hand);
    if (!grab) return;

    const node = this.sceneGraph.getNode(grab.nodeId);
    if (node) {
      // Dispatch set_transform command for undo support
      this.commandBus.exec({
        cmd: 'set_transform',
        id: grab.nodeId,
        position: [...node.transform.position],
        rotation: [...node.transform.rotation],
        scale: [...node.transform.scale],
      });
    }

    this.grabs.delete(hand);
  }

  isGrabbing(hand: 'left' | 'right'): boolean {
    return this.grabs.has(hand);
  }

  getGrabbedNodeId(hand: 'left' | 'right'): string | null {
    return this.grabs.get(hand)?.nodeId ?? null;
  }
}
