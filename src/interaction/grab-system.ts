import * as THREE from 'three';
import { Vec3, Vec4 } from '../types';
import { SceneGraph, SceneNode } from '../core/scene-graph';
import { CommandBus } from '../core/command-bus';

const GRAB_RADIUS = 0.15; // meters - how close hand must be to grab

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

  private grabs: Map<string, GrabState> = new Map(); // hand -> grab state

  constructor(scene: THREE.Scene, sceneGraph: SceneGraph, commandBus: CommandBus) {
    this.scene = scene;
    this.sceneGraph = sceneGraph;
    this.commandBus = commandBus;
  }

  tryGrab(hand: 'left' | 'right', position: Vec3, _direction: Vec3): boolean {
    const handPos = new THREE.Vector3(...position);

    // Find closest node within grab radius
    let closestNode: SceneNode | null = null;
    let closestDist = GRAB_RADIUS;

    this.sceneGraph.traverse((node) => {
      if (!node.mesh) return;

      // Distance from hand to mesh center
      const meshPos = node.mesh.position;
      const dist = handPos.distanceTo(meshPos);

      // Also check against bounding sphere for better accuracy
      if (!node.mesh.geometry.boundingSphere) {
        node.mesh.geometry.computeBoundingSphere();
      }
      const bs = node.mesh.geometry.boundingSphere;
      const surfaceDist = bs ? Math.max(0, dist - bs.radius * Math.max(
        node.mesh.scale.x, node.mesh.scale.y, node.mesh.scale.z
      )) : dist;

      if (surfaceDist < closestDist) {
        closestDist = surfaceDist;
        closestNode = node;
      }
    });

    if (!closestNode) return false;
    const node = closestNode as SceneNode;

    // Compute offset: primitive position relative to hand
    const meshPos = new THREE.Vector3(...node.transform.position);
    const offsetPos = meshPos.clone().sub(handPos);

    const handQuat = new THREE.Quaternion();
    const meshQuat = new THREE.Quaternion(
      node.transform.rotation[0],
      node.transform.rotation[1],
      node.transform.rotation[2],
      node.transform.rotation[3]
    );
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
