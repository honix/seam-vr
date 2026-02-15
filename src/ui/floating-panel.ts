// Base class for floating 3D panels in VR.
// Title bar and background are 3D meshes for raycasting/dragging.
// Content is rendered via Canvas 2D → CanvasTexture on a single plane (PanelCanvas).
// Resize corner at bottom-right allows 3D resizing.

import * as THREE from 'three';
import { createTextTexture } from './canvas-text';
import { PanelCanvas } from './panel-canvas';
import type { Widget } from './widgets';
import type { Vec3, Vec4 } from '../types';

const PANEL_BG_COLOR = 0x252540;
const PANEL_TITLE_COLOR = 0x3a3a6e;
const PANEL_OPACITY = 0.92;
const TITLE_BAR_HEIGHT = 0.03;
const RESIZE_HANDLE_SIZE = 0.02;
const MIN_WIDTH = 0.12;
const MIN_HEIGHT = 0.10;

export abstract class FloatingPanel {
  protected group: THREE.Group = new THREE.Group();
  protected backgroundMesh!: THREE.Mesh;
  protected titleBarMesh!: THREE.Mesh;
  private titleTextMesh!: THREE.Mesh;
  private resizeHandleMesh!: THREE.Mesh;
  protected panelCanvas!: PanelCanvas;

  protected width: number;
  protected height: number;
  protected title: string;
  private parentObj: THREE.Object3D;

  private _isOpen = false;
  private _isGrabbed = false;
  private grabOffset: THREE.Vector3 = new THREE.Vector3();
  private _grabDistance = 0;
  private _grabQuatOffset = new THREE.Quaternion();

  // Active widget for drag tracking (slider, color picker, etc.)
  private activeWidget: Widget | null = null;

  // Resize state
  private _isResizing = false;
  private resizeGrabDistance = 0;
  private resizeStartWidth = 0;
  private resizeStartHeight = 0;
  private resizeStartLocal = new THREE.Vector3();

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

    this.buildPanelMeshes();

    this.group.visible = false;
    this.parentObj.add(this.group);
  }

  /** Build or rebuild all panel geometry from current width/height. */
  private buildPanelMeshes(): void {
    // --- Dispose old meshes if rebuilding ---
    if (this.backgroundMesh) {
      this.group.remove(this.backgroundMesh);
      this.backgroundMesh.geometry.dispose();
      (this.backgroundMesh.material as THREE.Material).dispose();
    }
    if (this.titleBarMesh) {
      this.group.remove(this.titleBarMesh);
      this.titleBarMesh.geometry.dispose();
      (this.titleBarMesh.material as THREE.Material).dispose();
    }
    if (this.titleTextMesh) {
      this.group.remove(this.titleTextMesh);
      this.titleTextMesh.geometry.dispose();
      const mat = this.titleTextMesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    if (this.resizeHandleMesh) {
      this.group.remove(this.resizeHandleMesh);
      this.resizeHandleMesh.geometry.dispose();
      (this.resizeHandleMesh.material as THREE.Material).dispose();
    }

    const { width, height } = this;

    // Background plane
    const bgGeo = new THREE.PlaneGeometry(width, height);
    const bgMat = new THREE.MeshBasicMaterial({
      color: PANEL_BG_COLOR,
      transparent: true,
      opacity: PANEL_OPACITY,
      side: THREE.DoubleSide,
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
    });
    this.titleBarMesh = new THREE.Mesh(titleGeo, titleMat);
    this.titleBarMesh.position.set(0, height / 2 - TITLE_BAR_HEIGHT / 2, 0.001);
    this.group.add(this.titleBarMesh);

    // Title text
    const titleTex = createTextTexture(this.title, {
      fontSize: 24,
      color: '#ffffff',
      width: 256,
      height: 32,
    });
    const titleTextMat = new THREE.MeshBasicMaterial({
      map: titleTex,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const titleTextGeo = new THREE.PlaneGeometry(width * 0.8, TITLE_BAR_HEIGHT * 0.8);
    this.titleTextMesh = new THREE.Mesh(titleTextGeo, titleTextMat);
    this.titleTextMesh.position.set(0, height / 2 - TITLE_BAR_HEIGHT / 2, 0.002);
    this.group.add(this.titleTextMesh);

    // Resize handle (bottom-right triangle)
    const rhs = RESIZE_HANDLE_SIZE;
    const rhGeo = new THREE.BufferGeometry();
    rhGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      -rhs, 0, 0,
      0, rhs, 0,
    ], 3));
    rhGeo.setIndex([0, 1, 2]);
    rhGeo.computeVertexNormals();
    const rhMat = new THREE.MeshBasicMaterial({
      color: PANEL_TITLE_COLOR,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    });
    this.resizeHandleMesh = new THREE.Mesh(rhGeo, rhMat);
    this.resizeHandleMesh.position.set(width / 2, -height / 2, 0.003);
    this.group.add(this.resizeHandleMesh);

    // Content canvas: single mesh below title bar, aspect-correct
    const contentHeight = height - TITLE_BAR_HEIGHT;
    if (this.panelCanvas) {
      // Resize existing canvas
      this.panelCanvas.resizeMesh(width, contentHeight);
    } else {
      this.panelCanvas = new PanelCanvas(width, contentHeight);
    }
    this.panelCanvas.contentMesh.position.set(0, -TITLE_BAR_HEIGHT / 2, 0.002);
    // Ensure content mesh is parented
    if (!this.panelCanvas.contentMesh.parent) {
      this.group.add(this.panelCanvas.contentMesh);
    }
  }

  get isOpen(): boolean { return this._isOpen; }
  get isResizing(): boolean { return this._isResizing; }

  open(position: Vec3, faceToward?: Vec3): void {
    const worldPos = new THREE.Vector3(position[0], position[1], position[2]);
    const localPos = this.parentObj.worldToLocal(worldPos);
    this.group.position.copy(localPos);

    if (faceToward) {
      const target = new THREE.Vector3(faceToward[0], faceToward[1], faceToward[2]);
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
    this._isResizing = false;
    this.activeWidget = null;
  }

  toggle(position: Vec3, faceToward?: Vec3): void {
    if (this._isOpen) {
      this.close();
    } else {
      this.open(position, faceToward);
    }
  }

  releaseGrab(): void {
    this._isGrabbed = false;
  }

  get isGrabbed(): boolean { return this._isGrabbed; }

  /**
   * Ray hit test against the panel surface.
   * Returns 'title', 'resize', 'body', or null.
   */
  rayHitTest(raycaster: THREE.Raycaster): 'title' | 'resize' | 'body' | null {
    if (!this._isOpen) return null;

    // Test resize handle first (small, in front)
    const resizeHits = raycaster.intersectObject(this.resizeHandleMesh);
    if (resizeHits.length > 0) return 'resize';

    const titleHits = raycaster.intersectObject(this.titleBarMesh);
    if (titleHits.length > 0) return 'title';

    const bgHits = raycaster.intersectObject(this.backgroundMesh);
    if (bgHits.length > 0) return 'body';

    return null;
  }

  beginRayGrab(raycaster: THREE.Raycaster, controllerRotation?: Vec4): boolean {
    if (!this._isOpen) return false;
    const hits = raycaster.intersectObject(this.titleBarMesh);
    if (hits.length === 0) return false;

    this._isGrabbed = true;
    this._grabDistance = hits[0].distance;

    // Convert controller rotation to parent-local space
    const parentWorldQuat = new THREE.Quaternion();
    this.parentObj.getWorldQuaternion(parentWorldQuat);

    const localHit = this.parentObj.worldToLocal(hits[0].point.clone());
    const worldOffset = this.group.position.clone().sub(localHit);

    if (controllerRotation) {
      const controllerQuat = new THREE.Quaternion(...controllerRotation);
      const localControllerQuat = parentWorldQuat.clone().invert().multiply(controllerQuat);

      // Store position offset in controller-local space so it rotates with the hand
      this.grabOffset.copy(worldOffset.applyQuaternion(localControllerQuat.clone().invert()));

      // Store rotation offset: inverse(controllerLocal) * panelQuat
      this._grabQuatOffset.copy(localControllerQuat.clone().invert().multiply(this.group.quaternion));
    } else {
      this.grabOffset.copy(worldOffset);
    }

    return true;
  }

  updateRayGrab(raycaster: THREE.Raycaster, controllerRotation?: Vec4): void {
    if (!this._isGrabbed) return;
    const worldPoint = new THREE.Vector3();
    raycaster.ray.at(this._grabDistance, worldPoint);
    const localPoint = this.parentObj.worldToLocal(worldPoint);

    if (controllerRotation) {
      const controllerQuat = new THREE.Quaternion(...controllerRotation);
      const parentWorldQuat = new THREE.Quaternion();
      this.parentObj.getWorldQuaternion(parentWorldQuat);
      const localControllerQuat = parentWorldQuat.clone().invert().multiply(controllerQuat);

      // Rotate offset from controller-local back to parent-local space
      const rotatedOffset = this.grabOffset.clone().applyQuaternion(localControllerQuat);
      this.group.position.copy(localPoint.add(rotatedOffset));

      // Apply rotation
      this.group.quaternion.copy(localControllerQuat.clone().multiply(this._grabQuatOffset));
    } else {
      this.group.position.copy(localPoint.add(this.grabOffset));
    }
  }

  // --- Resize ---

  beginResize(raycaster: THREE.Raycaster): boolean {
    if (!this._isOpen) return false;
    const hits = raycaster.intersectObject(this.resizeHandleMesh);
    if (hits.length === 0) return false;

    this._isResizing = true;
    this.resizeGrabDistance = hits[0].distance;
    this.resizeStartWidth = this.width;
    this.resizeStartHeight = this.height;

    // Store the initial hit point in panel-local space
    const invMatrix = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    this.resizeStartLocal.copy(hits[0].point).applyMatrix4(invMatrix);
    return true;
  }

  updateResize(raycaster: THREE.Raycaster): void {
    if (!this._isResizing) return;

    // Project ray to grab distance to get current world point
    const worldPoint = new THREE.Vector3();
    raycaster.ray.at(this.resizeGrabDistance, worldPoint);

    // Convert to panel-local space
    const invMatrix = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const localPoint = worldPoint.applyMatrix4(invMatrix);

    // Delta from initial grab point
    const dx = localPoint.x - this.resizeStartLocal.x;
    const dy = localPoint.y - this.resizeStartLocal.y;

    // Resize: right = wider, down = taller (dy is negative when going down in local space)
    const newWidth = Math.max(MIN_WIDTH, this.resizeStartWidth + dx);
    const newHeight = Math.max(MIN_HEIGHT, this.resizeStartHeight - dy);

    this.resize(newWidth, newHeight);
  }

  endResize(): void {
    this._isResizing = false;
  }

  /** Resize the panel to new dimensions, rebuilding all geometry. */
  resize(newWidth: number, newHeight: number): void {
    this.width = newWidth;
    this.height = newHeight;
    this.buildPanelMeshes();
    this.buildContent();
  }

  protected abstract buildContent(): void;
  abstract updateContent(): void;

  /**
   * Test ray interaction with panel controls via PanelCanvas UV hit testing.
   * Returns true if the ray hit an interactive widget.
   */
  rayInteract(raycaster: THREE.Raycaster, phase: 'start' | 'update' | 'end'): boolean {
    if (phase === 'end') {
      if (this.activeWidget) {
        this.activeWidget.onPointerUp?.();
        this.activeWidget = null;
        this.panelCanvas.markDirty();
      }
      return false;
    }

    if (phase === 'update' && this.activeWidget) {
      const hit = this.panelCanvas.hitTest(raycaster);
      if (hit) {
        this.activeWidget.onPointerMove?.(hit.localX, hit.localY);
        this.panelCanvas.markDirty();
      }
      return true;
    }

    // 'start' phase: find which widget was hit
    const hit = this.panelCanvas.hitTest(raycaster);
    if (!hit) return false;

    if (hit.widget.onPointerDown?.(hit.localX, hit.localY)) {
      this.activeWidget = hit.widget;
      this.panelCanvas.markDirty();
      return true;
    }

    // Widget was hit but didn't capture the pointer - still consume the event
    this.panelCanvas.markDirty();
    return true;
  }

  isDraggingControl(): boolean {
    return this.activeWidget !== null;
  }

  /** Call each frame to flush dirty canvas to GPU texture. */
  updateCanvas(): void {
    this.panelCanvas.updateTexture();
  }

  dispose(): void {
    this.parentObj.remove(this.group);
    this.backgroundMesh.geometry.dispose();
    (this.backgroundMesh.material as THREE.Material).dispose();
    this.titleBarMesh.geometry.dispose();
    (this.titleBarMesh.material as THREE.Material).dispose();
    this.titleTextMesh.geometry.dispose();
    (this.titleTextMesh.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.titleTextMesh.material as THREE.Material).dispose();
    this.resizeHandleMesh.geometry.dispose();
    (this.resizeHandleMesh.material as THREE.Material).dispose();
    this.panelCanvas.dispose();
  }
}
