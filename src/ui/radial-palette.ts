import * as THREE from 'three';
import { Vec3, PrimitiveType } from '../types';
import { CommandBus } from '../core/command-bus';

const PALETTE_ITEMS: PrimitiveType[] = [
  'cylinder', 'sphere', 'box', 'cone', 'torus', 'capsule', 'tube',
];

const PALETTE_RADIUS = 0.15;
const ITEM_SCALE = 0.03;
const HIGHLIGHT_COLOR = 0xffaa00;
const DEFAULT_COLOR = 0xcccccc;

export class RadialPalette {
  private scene: THREE.Scene;
  private commandBus: CommandBus;
  private group: THREE.Group = new THREE.Group();
  private itemMeshes: THREE.Mesh[] = [];
  private itemTypes: PrimitiveType[] = [];
  private openPosition: Vec3 = [0, 0, 0];
  private highlightedIndex = -1;

  isOpen = false;

  constructor(scene: THREE.Scene, commandBus: CommandBus) {
    this.scene = scene;
    this.commandBus = commandBus;
    this.group.visible = false;
    this.scene.add(this.group);
    this.buildItems();
  }

  private buildItems(): void {
    for (let i = 0; i < PALETTE_ITEMS.length; i++) {
      const type = PALETTE_ITEMS[i];
      const angle = (i / PALETTE_ITEMS.length) * Math.PI * 2 - Math.PI / 2;

      const geometry = this.createPreviewGeometry(type);
      const material = new THREE.MeshBasicMaterial({ color: DEFAULT_COLOR });
      const mesh = new THREE.Mesh(geometry, material);

      mesh.position.set(
        Math.cos(angle) * PALETTE_RADIUS,
        Math.sin(angle) * PALETTE_RADIUS,
        0
      );
      mesh.scale.setScalar(ITEM_SCALE);

      this.group.add(mesh);
      this.itemMeshes.push(mesh);
      this.itemTypes.push(type);
    }
  }

  private createPreviewGeometry(type: PrimitiveType): THREE.BufferGeometry {
    switch (type) {
      case 'cylinder':
        return new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
      case 'sphere':
        return new THREE.SphereGeometry(0.5, 12, 8);
      case 'box':
        return new THREE.BoxGeometry(1, 1, 1);
      case 'cone':
        return new THREE.ConeGeometry(0.5, 1, 12);
      case 'torus':
        return new THREE.TorusGeometry(0.4, 0.15, 8, 16);
      case 'capsule':
        return new THREE.CapsuleGeometry(0.3, 0.6, 4, 12);
      case 'tube':
        return new THREE.TorusGeometry(0.4, 0.1, 8, 16, Math.PI);
      default:
        return new THREE.SphereGeometry(0.5, 8, 6);
    }
  }

  open(position: Vec3): void {
    this.openPosition = [...position] as Vec3;
    this.group.position.set(position[0], position[1], position[2]);
    this.group.visible = true;
    this.isOpen = true;
    this.highlightedIndex = -1;
  }

  close(): void {
    this.group.visible = false;
    this.isOpen = false;
    this.highlightedIndex = -1;
    this.resetColors();
  }

  update(pointerPosition: Vec3, triggerPressed: boolean): string | null {
    if (!this.isOpen) return null;

    // Find which item the pointer is closest to
    const pointer = new THREE.Vector3(...pointerPosition);
    const groupPos = this.group.position;
    const localPointer = pointer.clone().sub(groupPos);

    let closestIdx = -1;
    let closestDist = Infinity;

    for (let i = 0; i < this.itemMeshes.length; i++) {
      const itemPos = this.itemMeshes[i].position;
      const dist = localPointer.distanceTo(itemPos);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }

    // Only highlight if within reasonable distance
    const MAX_SELECT_DIST = PALETTE_RADIUS * 1.5;
    if (closestDist > MAX_SELECT_DIST) {
      closestIdx = -1;
    }

    // Update highlights
    if (closestIdx !== this.highlightedIndex) {
      this.resetColors();
      this.highlightedIndex = closestIdx;
      if (closestIdx >= 0) {
        (this.itemMeshes[closestIdx].material as THREE.MeshBasicMaterial).color.setHex(
          HIGHLIGHT_COLOR
        );
      }
    }

    // Selection on trigger
    if (triggerPressed && closestIdx >= 0) {
      const selectedType = this.itemTypes[closestIdx];
      this.spawnPrimitive(selectedType);
      return selectedType;
    }

    return null;
  }

  private spawnPrimitive(type: PrimitiveType): void {
    // Spawn at the palette position, slightly in front
    const id = `${type}_${Date.now()}`;
    this.commandBus.exec({
      cmd: 'spawn',
      type,
      id,
      position: [...this.openPosition],
    });
  }

  private resetColors(): void {
    for (const mesh of this.itemMeshes) {
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(DEFAULT_COLOR);
    }
  }
}
