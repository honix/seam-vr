// World Navigation - grip-based world manipulation (pan, scale, rotate)
// Single grip: pan + rotate world (grab-and-twist: position + wrist rotation)
// Dual grip: scale + full 3-axis rotate world around midpoint between controllers
//            Uses orthonormal frame from positions + controller orientations for 3-DOF rotation
//            (inter-hand direction gives yaw/pitch, averaged controller up gives roll/twist)

import * as THREE from 'three';
import type { Vec3 } from '../types';

interface GripState {
  hand: 'left' | 'right';
  startControllerPos: THREE.Vector3;
  startControllerQuat: THREE.Quaternion;
  startWorldGroupPos: THREE.Vector3;
  startWorldGroupQuat: THREE.Quaternion;
}

export class WorldNavigation {
  private worldGroup: THREE.Group;
  private grips: Map<string, GripState> = new Map();

  // Live controller state, updated each frame via updateGrip
  private livePositions: Map<string, THREE.Vector3> = new Map();
  private liveRotations: Map<string, THREE.Quaternion> = new Map();

  // Dual-grip reference state
  private dualGripStartDist: number = 0;
  private dualGripStartScale: number = 1;
  private dualGripStartQuat: THREE.Quaternion = new THREE.Quaternion();
  private dualGripMidpoint: THREE.Vector3 = new THREE.Vector3();
  private dualGripStartFrameQuat: THREE.Quaternion = new THREE.Quaternion();

  constructor(worldGroup: THREE.Group) {
    this.worldGroup = worldGroup;
  }

  beginGrip(hand: 'left' | 'right', position: Vec3, rotation: [number, number, number, number]): void {
    const controllerPos = new THREE.Vector3(position[0], position[1], position[2]);
    const controllerQuat = new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]);

    this.livePositions.set(hand, controllerPos.clone());
    this.liveRotations.set(hand, controllerQuat.clone());

    const grip: GripState = {
      hand,
      startControllerPos: controllerPos.clone(),
      startControllerQuat: controllerQuat.clone(),
      startWorldGroupPos: this.worldGroup.position.clone(),
      startWorldGroupQuat: this.worldGroup.quaternion.clone(),
    };

    this.grips.set(hand, grip);

    // Second grip → initialize dual-grip state
    if (this.grips.size === 2) {
      this.initDualGrip();
    }
  }

  updateGrip(hand: 'left' | 'right', position: Vec3, rotation: [number, number, number, number]): void {
    const grip = this.grips.get(hand);
    if (!grip) return;

    const currentPos = new THREE.Vector3(position[0], position[1], position[2]);
    const currentQuat = new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]);
    this.livePositions.set(hand, currentPos);
    this.liveRotations.set(hand, currentQuat);

    if (this.grips.size === 2) {
      this.updateDualGrip();
    } else {
      this.updateSingleGrip(grip, currentPos, currentQuat);
    }
  }

  endGrip(hand: 'left' | 'right'): void {
    const wasDualGrip = this.grips.size === 2;
    this.grips.delete(hand);
    this.livePositions.delete(hand);
    this.liveRotations.delete(hand);

    // Seamless dual → single transition: snapshot current state
    // so the remaining hand continues with no view jump
    if (wasDualGrip && this.grips.size === 1) {
      const remaining = this.grips.values().next().value as GripState;
      const livePos = this.livePositions.get(remaining.hand);
      const liveRot = this.liveRotations.get(remaining.hand);
      if (livePos) remaining.startControllerPos.copy(livePos);
      if (liveRot) remaining.startControllerQuat.copy(liveRot);
      remaining.startWorldGroupPos.copy(this.worldGroup.position);
      remaining.startWorldGroupQuat.copy(this.worldGroup.quaternion);
    }
  }

  /**
   * Single-grip: pan + rotate world (grab-and-twist metaphor).
   * Controller rotation delta rotates the world around the grip point.
   * Controller position delta pans the world.
   */
  private updateSingleGrip(grip: GripState, currentPos: THREE.Vector3, currentQuat: THREE.Quaternion): void {
    // Delta rotation: how much the controller rotated since grab start
    const deltaQuat = currentQuat.clone()
      .multiply(grip.startControllerQuat.clone().invert());

    // Rotate world by delta
    this.worldGroup.quaternion.copy(deltaQuat).multiply(grip.startWorldGroupQuat);

    // Position: pivot around the grip point
    // offset = vector from grip point to world origin at start
    // new position = current controller pos + rotated offset
    const offset = new THREE.Vector3()
      .copy(grip.startWorldGroupPos)
      .sub(grip.startControllerPos);
    offset.applyQuaternion(deltaQuat);
    this.worldGroup.position.copy(currentPos).add(offset);
  }

  /**
   * Build an orthonormal frame from two controller positions + rotations.
   * X = inter-hand direction, Y = averaged controller up (orthogonalized), Z = cross(X,Y).
   * Returns the frame as a quaternion, or null if degenerate.
   */
  private buildGripFrame(
    posA: THREE.Vector3, posB: THREE.Vector3,
    quatA: THREE.Quaternion, quatB: THREE.Quaternion,
  ): THREE.Quaternion | null {
    // X axis: direction from controller A to controller B
    const x = new THREE.Vector3().copy(posB).sub(posA);
    if (x.lengthSq() < 0.000001) return null; // controllers overlapping
    x.normalize();

    // Average controller "up" vectors
    const upA = new THREE.Vector3(0, 1, 0).applyQuaternion(quatA);
    const upB = new THREE.Vector3(0, 1, 0).applyQuaternion(quatB);
    const avgUp = upA.add(upB).normalize();

    // Gram-Schmidt: orthogonalize avgUp against X to get Y
    const y = avgUp.clone().sub(x.clone().multiplyScalar(avgUp.dot(x)));
    if (y.lengthSq() < 0.000001) return null; // up parallel to inter-hand direction
    y.normalize();

    // Z = X cross Y
    const z = new THREE.Vector3().crossVectors(x, y);

    const mat = new THREE.Matrix4().makeBasis(x, y, z);
    return new THREE.Quaternion().setFromRotationMatrix(mat);
  }

  /**
   * Initialize dual-grip state. Snapshots both hands to their current live
   * positions so the transition from single-grip is seamless.
   */
  private initDualGrip(): void {
    const hands = [...this.grips.values()];

    // Snapshot both hands to current live state for seamless single → dual transition
    for (const grip of hands) {
      const livePos = this.livePositions.get(grip.hand);
      const liveRot = this.liveRotations.get(grip.hand);
      if (livePos) grip.startControllerPos.copy(livePos);
      if (liveRot) grip.startControllerQuat.copy(liveRot);
      grip.startWorldGroupPos.copy(this.worldGroup.position);
      grip.startWorldGroupQuat.copy(this.worldGroup.quaternion);
    }

    const posA = hands[0].startControllerPos;
    const posB = hands[1].startControllerPos;

    // Full 3D distance (for scale)
    this.dualGripStartDist = posA.distanceTo(posB);
    if (this.dualGripStartDist < 0.001) {
      this.dualGripStartDist = 0.001;
    }

    // Build start frame from positions + controller orientations (3 DOF)
    this.dualGripStartFrameQuat = this.buildGripFrame(
      posA, posB,
      hands[0].startControllerQuat, hands[1].startControllerQuat,
    ) ?? new THREE.Quaternion();

    // Store current world state
    this.dualGripStartScale = this.worldGroup.scale.x;
    this.dualGripStartQuat.copy(this.worldGroup.quaternion);

    // Midpoint between controllers at start
    this.dualGripMidpoint.copy(posA).add(posB).multiplyScalar(0.5);
  }

  /**
   * Dual-grip: scale + full 3-axis rotate around midpoint.
   * Scale from inter-hand distance ratio. Rotation from orthonormal frame delta
   * (captures yaw, pitch from inter-hand direction AND roll from controller orientations).
   */
  private updateDualGrip(): void {
    const hands = [...this.grips.values()];
    const posA = this.livePositions.get(hands[0].hand)!;
    const posB = this.livePositions.get(hands[1].hand)!;
    const quatA = this.liveRotations.get(hands[0].hand)!;
    const quatB = this.liveRotations.get(hands[1].hand)!;

    // Full 3D distance
    const currentDist = posA.distanceTo(posB);

    // Scale: hands apart = zoom in, hands together = zoom out
    const scaleRatio = Math.max(currentDist, 0.001) / this.dualGripStartDist;
    const newScale = this.dualGripStartScale * scaleRatio;

    // Build current frame; skip rotation update if degenerate
    const currentFrameQuat = this.buildGripFrame(posA, posB, quatA, quatB);
    let deltaQuat: THREE.Quaternion;
    if (currentFrameQuat) {
      deltaQuat = currentFrameQuat.clone()
        .multiply(this.dualGripStartFrameQuat.clone().invert());
    } else {
      deltaQuat = new THREE.Quaternion(); // identity fallback
    }

    // Current midpoint
    const currentMidpoint = new THREE.Vector3()
      .copy(posA).add(posB).multiplyScalar(0.5);

    // Apply scale
    this.worldGroup.scale.setScalar(newScale);

    // Apply full 3-axis rotation
    this.worldGroup.quaternion.copy(deltaQuat).multiply(this.dualGripStartQuat);

    // Translate: pivot around midpoint
    const offsetFromMidpoint = new THREE.Vector3()
      .copy(hands[0].startWorldGroupPos)
      .sub(this.dualGripMidpoint);
    offsetFromMidpoint.multiplyScalar(scaleRatio);
    offsetFromMidpoint.applyQuaternion(deltaQuat);
    this.worldGroup.position.copy(currentMidpoint).add(offsetFromMidpoint);
  }

  /** Transform a world-space position into worldGroup local space. */
  worldToLocal(worldPos: Vec3): Vec3 {
    const v = new THREE.Vector3(worldPos[0], worldPos[1], worldPos[2]);
    this.worldGroup.worldToLocal(v);
    return [v.x, v.y, v.z];
  }

  /** Current uniform scale of the worldGroup (for brush radius compensation). */
  getScale(): number {
    return this.worldGroup.scale.x;
  }
}
