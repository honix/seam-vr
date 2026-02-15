// World Navigation - grip-based world manipulation (pan, scale, rotate)
// Single grip: pan world (grab and drag metaphor)
// Dual grip: scale + rotate world around midpoint between controllers

import * as THREE from 'three';
import type { Vec3 } from '../types';

interface GripState {
  hand: 'left' | 'right';
  startControllerPos: THREE.Vector3;
  startWorldGroupPos: THREE.Vector3;
}

export class WorldNavigation {
  private worldGroup: THREE.Group;
  private grips: Map<string, GripState> = new Map();

  // Live controller positions, updated each frame via updateGrip
  private livePositions: Map<string, THREE.Vector3> = new Map();

  // For dual-grip: store initial inter-hand distance and angle
  private dualGripStartDist: number = 0;
  private dualGripStartAngle: number = 0;
  private dualGripStartScale: number = 1;
  private dualGripStartRotY: number = 0;
  private dualGripMidpoint: THREE.Vector3 = new THREE.Vector3();

  constructor(worldGroup: THREE.Group) {
    this.worldGroup = worldGroup;
  }

  beginGrip(hand: 'left' | 'right', position: Vec3, _rotation: [number, number, number, number]): void {
    const controllerPos = new THREE.Vector3(position[0], position[1], position[2]);

    this.livePositions.set(hand, controllerPos.clone());

    const grip: GripState = {
      hand,
      startControllerPos: controllerPos.clone(),
      startWorldGroupPos: this.worldGroup.position.clone(),
    };

    this.grips.set(hand, grip);

    // If this is the second grip, initialize dual-grip state
    if (this.grips.size === 2) {
      this.initDualGrip();
    }
  }

  updateGrip(hand: 'left' | 'right', position: Vec3, _rotation: [number, number, number, number]): void {
    const grip = this.grips.get(hand);
    if (!grip) return;

    const currentPos = new THREE.Vector3(position[0], position[1], position[2]);
    this.livePositions.set(hand, currentPos);

    if (this.grips.size === 2) {
      // Dual-grip: scale + rotate around midpoint
      this.updateDualGrip();
    } else {
      // Single-grip: pan world
      // The world moves inversely to the hand (grab and drag metaphor)
      // worldGroup.position = startWorldGroupPos + (startControllerPos - currentControllerPos)
      this.worldGroup.position.copy(grip.startWorldGroupPos)
        .add(grip.startControllerPos)
        .sub(currentPos);
    }
  }

  endGrip(hand: 'left' | 'right'): void {
    const wasDualGrip = this.grips.size === 2;
    this.grips.delete(hand);
    this.livePositions.delete(hand);

    // When one grip releases during dual grip, fall back to single-grip pan
    // with the remaining hand. Reset that hand's start state to current positions.
    if (wasDualGrip && this.grips.size === 1) {
      const remaining = this.grips.values().next().value as GripState;
      const livePos = this.livePositions.get(remaining.hand);
      if (livePos) {
        remaining.startControllerPos.copy(livePos);
      }
      remaining.startWorldGroupPos.copy(this.worldGroup.position);
    }
  }

  /**
   * Initialize dual-grip state: record distance, angle, scale, and rotation
   * between the two controllers.
   */
  private initDualGrip(): void {
    const hands = [...this.grips.values()];
    const posA = hands[0].startControllerPos;
    const posB = hands[1].startControllerPos;

    // Distance between controllers on XZ plane (for scale)
    const dx = posB.x - posA.x;
    const dz = posB.z - posA.z;
    this.dualGripStartDist = Math.sqrt(dx * dx + dz * dz);
    if (this.dualGripStartDist < 0.001) {
      this.dualGripStartDist = 0.001; // Prevent division by zero
    }

    // Angle of line between controllers projected onto XZ plane (Y-axis rotation)
    this.dualGripStartAngle = Math.atan2(dz, dx);

    // Store current world state
    this.dualGripStartScale = this.worldGroup.scale.x;
    this.dualGripStartRotY = this.worldGroup.rotation.y;

    // Midpoint between controllers at start
    this.dualGripMidpoint.copy(posA).add(posB).multiplyScalar(0.5);
  }

  /**
   * Update dual-grip: compute scale ratio and rotation from current controller positions.
   * Scale and rotation are applied around the midpoint between controllers.
   */
  private updateDualGrip(): void {
    const hands = [...this.grips.values()];
    const posA = this.livePositions.get(hands[0].hand)!;
    const posB = this.livePositions.get(hands[1].hand)!;

    // Current distance between controllers on XZ plane
    const dx = posB.x - posA.x;
    const dz = posB.z - posA.z;
    const currentDist = Math.sqrt(dx * dx + dz * dz);

    // Scale ratio: hands apart = scale down / zoom out, hands together = scale up / zoom in
    const scaleRatio = this.dualGripStartDist / Math.max(currentDist, 0.001);
    const newScale = this.dualGripStartScale * scaleRatio;

    // Current angle on XZ plane
    const currentAngle = Math.atan2(dz, dx);
    const angleDelta = currentAngle - this.dualGripStartAngle;

    // Current midpoint between controllers
    const currentMidpoint = new THREE.Vector3()
      .copy(posA).add(posB).multiplyScalar(0.5);

    // Apply scale
    this.worldGroup.scale.setScalar(newScale);

    // Apply Y-axis rotation
    this.worldGroup.rotation.y = this.dualGripStartRotY + angleDelta;

    // Translate so the world pivots around the midpoint between controllers:
    // 1. Vector from start midpoint to world origin at start
    const offsetFromMidpoint = new THREE.Vector3()
      .copy(hands[0].startWorldGroupPos)
      .sub(this.dualGripMidpoint);

    // 2. Scale the offset
    offsetFromMidpoint.multiplyScalar(scaleRatio);

    // 3. Rotate the offset around Y axis
    const cos = Math.cos(angleDelta);
    const sin = Math.sin(angleDelta);
    const rx = offsetFromMidpoint.x * cos - offsetFromMidpoint.z * sin;
    const rz = offsetFromMidpoint.x * sin + offsetFromMidpoint.z * cos;
    offsetFromMidpoint.x = rx;
    offsetFromMidpoint.z = rz;

    // 4. New world position = currentMidpoint + rotated/scaled offset
    this.worldGroup.position.copy(currentMidpoint).add(offsetFromMidpoint);
  }
}
