// Base class for floating 3D panels in VR.
// Semi-transparent dark background, grabbable title bar, abstract content area.

import * as THREE from 'three';
import { createTextTexture } from './canvas-text';
import type { Vec3 } from '../types';

const PANEL_BG_COLOR = 0x1a1a2e;
const PANEL_TITLE_COLOR = 0x2a2a4e;
const PANEL_OPACITY = 0.85;
const TITLE_BAR_HEIGHT = 0.03;
const GRAB_THRESHOLD = 0.08; // meters

export abstract class FloatingPanel {
  protected group: THREE.Group = new THREE.Group();
  protected backgroundMesh: THREE.Mesh;
  protected titleBarMesh: THREE.Mesh;
  protected contentGroup: THREE.Group = new THREE.Group();

  protected width: number;
  protected height: number;
  protected title: string;

  private _isOpen = false;
  private _isGrabbed = false;
  private grabOffset: THREE.Vector3 = new THREE.Vector3();

  constructor(
    protected scene: THREE.Scene,
    title: string,
    width = 0.3,
    height = 0.4,
  ) {
    this.title = title;
    this.width = width;
    this.height = height;

    // Background plane
    const bgGeo = new THREE.PlaneGeometry(width, height);
    const bgMat = new THREE.MeshBasicMaterial({
      color: PANEL_BG_COLOR,
      transparent: true,
      opacity: PANEL_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.backgroundMesh = new THREE.Mesh(bgGeo, bgMat);
    this.group.add(this.backgroundMesh);

    // Title bar
    const titleGeo = new THREE.PlaneGeometry(width, TITLE_BAR_HEIGHT);
    const titleMat = new THREE.MeshBasicMaterial({
      color: PANEL_TITLE_COLOR,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.titleBarMesh = new THREE.Mesh(titleGeo, titleMat);
    this.titleBarMesh.position.set(0, height / 2 - TITLE_BAR_HEIGHT / 2, 0.001);
    this.group.add(this.titleBarMesh);

    // Title text
    const titleTex = createTextTexture(title, {
      fontSize: 24,
      color: '#ffffff',
      width: 256,
      height: 32,
    });
    const titleTextMat = new THREE.MeshBasicMaterial({
      map: titleTex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const titleTextGeo = new THREE.PlaneGeometry(width * 0.8, TITLE_BAR_HEIGHT * 0.8);
    const titleTextMesh = new THREE.Mesh(titleTextGeo, titleTextMat);
    titleTextMesh.position.set(0, height / 2 - TITLE_BAR_HEIGHT / 2, 0.002);
    this.group.add(titleTextMesh);

    // Content area
    this.contentGroup.position.set(0, -TITLE_BAR_HEIGHT / 2, 0.002);
    this.group.add(this.contentGroup);

    this.group.visible = false;
    this.group.renderOrder = 1000;
    this.scene.add(this.group);
  }

  get isOpen(): boolean { return this._isOpen; }

  open(position: Vec3, faceToward?: Vec3): void {
    this.group.position.set(position[0], position[1], position[2]);
    if (faceToward) {
      this.group.lookAt(faceToward[0], faceToward[1], faceToward[2]);
    }
    this.group.visible = true;
    this._isOpen = true;
    this.buildContent();
  }

  close(): void {
    this.group.visible = false;
    this._isOpen = false;
    this._isGrabbed = false;
  }

  toggle(position: Vec3, faceToward?: Vec3): void {
    if (this._isOpen) {
      this.close();
    } else {
      this.open(position, faceToward);
    }
  }

  /**
   * Try to grab the panel's title bar.
   * Returns true if the grip position is close enough to the title bar.
   */
  tryGrab(gripPosition: Vec3): boolean {
    if (!this._isOpen) return false;

    const titleWorldPos = new THREE.Vector3();
    this.titleBarMesh.getWorldPosition(titleWorldPos);
    const gripPos = new THREE.Vector3(...gripPosition);
    const dist = gripPos.distanceTo(titleWorldPos);

    if (dist < GRAB_THRESHOLD) {
      this._isGrabbed = true;
      this.grabOffset.copy(this.group.position).sub(gripPos);
      return true;
    }
    return false;
  }

  /**
   * Update panel position while grabbed.
   */
  updateGrab(gripPosition: Vec3): void {
    if (!this._isGrabbed) return;
    const gripPos = new THREE.Vector3(...gripPosition);
    this.group.position.copy(gripPos.add(this.grabOffset));
  }

  /**
   * Release grab.
   */
  releaseGrab(): void {
    this._isGrabbed = false;
  }

  get isGrabbed(): boolean { return this._isGrabbed; }

  /**
   * Subclasses implement this to populate contentGroup.
   */
  protected abstract buildContent(): void;

  /**
   * Subclasses implement this to refresh displayed data.
   */
  abstract updateContent(): void;

  /**
   * Test ray interaction with panel controls.
   * Override in subclasses with interactive elements.
   * Returns true if the ray hit an interactive control.
   */
  rayInteract(raycaster: THREE.Raycaster, phase: 'start' | 'update' | 'end'): boolean {
    return false;
  }

  /**
   * Returns true if a control drag is in progress (slider, color picker, etc.).
   */
  isDraggingControl(): boolean {
    return false;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.backgroundMesh.geometry.dispose();
    (this.backgroundMesh.material as THREE.Material).dispose();
    this.titleBarMesh.geometry.dispose();
    (this.titleBarMesh.material as THREE.Material).dispose();
  }
}
