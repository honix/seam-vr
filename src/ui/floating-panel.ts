// Base class for floating 3D panels in VR.
// Semi-transparent dark background, trigger-drag title bar, abstract content area.
// Panels live in worldGroup so they move with world navigation (pan/zoom/rotate).

import * as THREE from 'three';
import { createTextTexture } from './canvas-text';
import type { Vec3 } from '../types';

const PANEL_BG_COLOR = 0x1a1a2e;
const PANEL_TITLE_COLOR = 0x2a2a4e;
const PANEL_OPACITY = 0.85;
const TITLE_BAR_HEIGHT = 0.03;

export abstract class FloatingPanel {
  protected group: THREE.Group = new THREE.Group();
  protected backgroundMesh: THREE.Mesh;
  protected titleBarMesh: THREE.Mesh;
  protected contentGroup: THREE.Group = new THREE.Group();

  protected width: number;
  protected height: number;
  protected title: string;
  private parentObj: THREE.Object3D;

  private _isOpen = false;
  private _isGrabbed = false;
  private grabOffset: THREE.Vector3 = new THREE.Vector3();
  private _grabDistance = 0;

  constructor(
    parent: THREE.Object3D,
    title: string,
    width = 0.3,
    height = 0.4,
  ) {
    this.title = title;
    this.width = width;
    this.height = height;
    this.parentObj = parent;

    // Background plane
    const bgGeo = new THREE.PlaneGeometry(width, height);
    const bgMat = new THREE.MeshBasicMaterial({
      color: PANEL_BG_COLOR,
      transparent: true,
      opacity: PANEL_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.backgroundMesh = new THREE.Mesh(bgGeo, bgMat);
    this.backgroundMesh.renderOrder = 1000;
    this.group.add(this.backgroundMesh);

    // Title bar
    const titleGeo = new THREE.PlaneGeometry(width, TITLE_BAR_HEIGHT);
    const titleMat = new THREE.MeshBasicMaterial({
      color: PANEL_TITLE_COLOR,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.titleBarMesh = new THREE.Mesh(titleGeo, titleMat);
    this.titleBarMesh.renderOrder = 1001;
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
      depthTest: false,
    });
    const titleTextGeo = new THREE.PlaneGeometry(width * 0.8, TITLE_BAR_HEIGHT * 0.8);
    const titleTextMesh = new THREE.Mesh(titleTextGeo, titleTextMat);
    titleTextMesh.renderOrder = 1002;
    titleTextMesh.position.set(0, height / 2 - TITLE_BAR_HEIGHT / 2, 0.002);
    this.group.add(titleTextMesh);

    // Content area
    this.contentGroup.position.set(0, -TITLE_BAR_HEIGHT / 2, 0.002);
    this.group.add(this.contentGroup);

    this.group.visible = false;
    this.group.renderOrder = 1000;
    this.parentObj.add(this.group);
  }

  get isOpen(): boolean { return this._isOpen; }

  /**
   * Open the panel at a world-space position.
   * Converts to parent local space automatically.
   */
  open(position: Vec3, faceToward?: Vec3): void {
    // Convert world-space position to parent local space
    const worldPos = new THREE.Vector3(position[0], position[1], position[2]);
    const localPos = this.parentObj.worldToLocal(worldPos);
    this.group.position.copy(localPos);

    if (faceToward) {
      // lookAt needs world-space target, but group is in parent space.
      // Temporarily compute in world space.
      const worldGroupPos = new THREE.Vector3();
      this.group.getWorldPosition(worldGroupPos);
      const target = new THREE.Vector3(faceToward[0], faceToward[1], faceToward[2]);
      // Convert target to parent local space for lookAt
      const localTarget = this.parentObj.worldToLocal(target);
      this.group.lookAt(localTarget);
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
   * Release grab.
   */
  releaseGrab(): void {
    this._isGrabbed = false;
  }

  get isGrabbed(): boolean { return this._isGrabbed; }

  /**
   * Ray hit test against the panel surface.
   * Returns 'title' if the ray hits the title bar, 'body' if it hits the background, null if miss.
   * Raycaster works in world space; Three.js handles the parent transform internally.
   */
  rayHitTest(raycaster: THREE.Raycaster): 'title' | 'body' | null {
    if (!this._isOpen) return null;

    // Test title bar first (it's in front)
    const titleHits = raycaster.intersectObject(this.titleBarMesh);
    if (titleHits.length > 0) return 'title';

    // Test background
    const bgHits = raycaster.intersectObject(this.backgroundMesh);
    if (bgHits.length > 0) return 'body';

    return null;
  }

  /**
   * Begin a ray-based grab (trigger on title bar).
   * Converts world-space hit to parent local space for correct offset.
   */
  beginRayGrab(raycaster: THREE.Raycaster): boolean {
    if (!this._isOpen) return false;
    const hits = raycaster.intersectObject(this.titleBarMesh);
    if (hits.length === 0) return false;

    this._isGrabbed = true;
    this._grabDistance = hits[0].distance;

    // Convert hit point to parent local space, compute offset from panel position
    const localHit = this.parentObj.worldToLocal(hits[0].point.clone());
    this.grabOffset.copy(this.group.position).sub(localHit);
    return true;
  }

  /**
   * Update ray-based grab: project ray to stored distance, convert to parent local space.
   */
  updateRayGrab(raycaster: THREE.Raycaster): void {
    if (!this._isGrabbed) return;
    const worldPoint = new THREE.Vector3();
    raycaster.ray.at(this._grabDistance, worldPoint);
    const localPoint = this.parentObj.worldToLocal(worldPoint);
    this.group.position.copy(localPoint.add(this.grabOffset));
  }

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
    this.parentObj.remove(this.group);
    this.backgroundMesh.geometry.dispose();
    (this.backgroundMesh.material as THREE.Material).dispose();
    this.titleBarMesh.geometry.dispose();
    (this.titleBarMesh.material as THREE.Material).dispose();
  }
}
