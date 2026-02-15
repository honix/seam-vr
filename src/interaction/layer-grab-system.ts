// Layer grab system - Move Layer tool handler.
// Grabs layers by proximity and moves/rotates them via controller input.
// Issues set_transform commands through the command bus for undo support.

import * as THREE from 'three';
import { SceneGraph, SceneNode } from '../core/scene-graph';
import { CommandBus } from '../core/command-bus';
import type { Vec3, Vec4 } from '../types';

const GRAB_RADIUS = 0.2; // meters

interface LayerGrabState {
  nodeId: string;
  offsetPosition: THREE.Vector3;
  offsetQuaternion: THREE.Quaternion;
  initialPosition: Vec3;
  initialRotation: Vec4;
  initialScale: Vec3;
}

export class LayerGrabSystem {
  private sceneGraph: SceneGraph;
  private commandBus: CommandBus;
  private grabs: Map<string, LayerGrabState> = new Map();

  constructor(sceneGraph: SceneGraph, commandBus: CommandBus) {
    this.sceneGraph = sceneGraph;
    this.commandBus = commandBus;
  }

  /**
   * Try to grab the closest layer within range.
   */
  tryGrab(hand: 'left' | 'right', position: Vec3): boolean {
    const handPos = new THREE.Vector3(...position);

    let closestNode: SceneNode | null = null;
    let closestDist = GRAB_RADIUS;

    this.sceneGraph.traverse((node) => {
      if (node.locked) return;
      if (!node.mesh) return;

      const meshWorldPos = new THREE.Vector3();
      node.mesh.getWorldPosition(meshWorldPos);
      const dist = handPos.distanceTo(meshWorldPos);

      if (!node.mesh.geometry.boundingSphere) {
        node.mesh.geometry.computeBoundingSphere();
      }
      const bs = node.mesh.geometry.boundingSphere;
      const maxScale = Math.max(node.mesh.scale.x, node.mesh.scale.y, node.mesh.scale.z);
      const surfaceDist = bs ? Math.max(0, dist - bs.radius * maxScale) : dist;

      if (surfaceDist < closestDist) {
        closestDist = surfaceDist;
        closestNode = node;
      }
    });

    if (!closestNode) return false;
    const node = closestNode as SceneNode;

    const meshPos = new THREE.Vector3(...node.transform.position);
    const offsetPos = meshPos.clone().sub(handPos);

    const meshQuat = new THREE.Quaternion(
      node.transform.rotation[0],
      node.transform.rotation[1],
      node.transform.rotation[2],
      node.transform.rotation[3],
    );
    const handQuat = new THREE.Quaternion(); // identity
    const offsetQuat = handQuat.clone().invert().multiply(meshQuat);

    this.grabs.set(hand, {
      nodeId: node.id,
      offsetPosition: offsetPos,
      offsetQuaternion: offsetQuat,
      initialPosition: [...node.transform.position],
      initialRotation: [...node.transform.rotation],
      initialScale: [...node.transform.scale],
    });

    return true;
  }

  /**
   * Update grab position/rotation each frame while trigger is held.
   */
  updateGrab(hand: 'left' | 'right', position: Vec3, rotation: Vec4): void {
    const grab = this.grabs.get(hand);
    if (!grab) return;

    const node = this.sceneGraph.getNode(grab.nodeId);
    if (!node) {
      this.grabs.delete(hand);
      return;
    }

    const handPos = new THREE.Vector3(...position);
    const newPos = handPos.clone().add(grab.offsetPosition);
    node.transform.position = [newPos.x, newPos.y, newPos.z];

    const handQuat = new THREE.Quaternion(...rotation);
    const newQuat = handQuat.clone().multiply(grab.offsetQuaternion);
    node.transform.rotation = [newQuat.x, newQuat.y, newQuat.z, newQuat.w];

    if (node.mesh) {
      node.mesh.position.copy(newPos);
      node.mesh.quaternion.copy(newQuat);
    }
  }

  /**
   * Release grab and commit transform via command bus.
   */
  releaseGrab(hand: 'left' | 'right'): void {
    const grab = this.grabs.get(hand);
    if (!grab) return;

    const node = this.sceneGraph.getNode(grab.nodeId);
    if (node) {
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
}
