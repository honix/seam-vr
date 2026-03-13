// Base class for floating 3D panels in VR.
// Panels can be hand-hosted or world-hosted, with Canvas 2D content and 3D chrome.

import * as THREE from 'three';
import { createTextTexture } from './canvas-text';
import { PanelCanvas } from './panel-canvas';
import type { Widget } from './widgets';
import type { Hand, Vec3, Vec4 } from '../types';

const PANEL_BG_COLOR = 0x252540;
const PANEL_TITLE_COLOR = 0x3a3a6e;
const PANEL_OPACITY = 0.92;
const TITLE_BAR_HEIGHT = 0.03;
const RESIZE_HANDLE_SIZE = 0.02;
const CLOSE_BUTTON_SIZE = 0.018;
const MIN_WIDTH = 0.12;
const MIN_HEIGHT = 0.10;
const TARGET_LINE_COLOR = 0xffaa33;

export abstract class FloatingPanel {
  protected group: THREE.Group = new THREE.Group();
  protected backgroundMesh!: THREE.Mesh;
  protected titleBarMesh!: THREE.Mesh;
  private titleTextMesh!: THREE.Mesh;
  private resizeHandleMesh!: THREE.Mesh;
  private closeButtonMesh!: THREE.Mesh;
  private targetLine: THREE.Line | null = null;
  protected panelCanvas!: PanelCanvas;

  protected width: number;
  protected height: number;
  protected title: string;
  private parentObj: THREE.Object3D;

  hostMode: 'hand' | 'world' = 'world';
  ownerHand: Hand | null = null;

  private _isOpen = false;
  private _isGrabbed = false;
  private grabOffset: THREE.Vector3 = new THREE.Vector3();
  private _grabDistance = 0;
  private _grabQuatOffset = new THREE.Quaternion();

  private activeWidget: Widget | null = null;

  private _isResizing = false;
  private resizeGrabDistance = 0;
  private resizeStartWidth = 0;
  private resizeStartHeight = 0;
  private resizeStartLocal = new THREE.Vector3();

  private showCloseButton = true;
  private targetObject: THREE.Object3D | null = null;
  private targetLineEnabled = false;

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

  setHostMode(mode: 'hand' | 'world'): void {
    this.hostMode = mode;
    this.showCloseButton = mode === 'world';
    if (this.closeButtonMesh) {
      this.closeButtonMesh.visible = this.showCloseButton;
    }
  }

  setOwnerHand(hand: Hand | null): void {
    this.ownerHand = hand;
  }

  setTargetObject(target: THREE.Object3D | null, enabled = true): void {
    this.targetObject = target;
    this.targetLineEnabled = enabled;
    this.updateTargetLine();
  }

  private buildPanelMeshes(): void {
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
    if (this.closeButtonMesh) {
      this.group.remove(this.closeButtonMesh);
      this.closeButtonMesh.geometry.dispose();
      const mat = this.closeButtonMesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }

    const { width, height } = this;

    const bgGeo = new THREE.PlaneGeometry(width, height);
    const bgMat = new THREE.MeshBasicMaterial({
      color: PANEL_BG_COLOR,
      transparent: true,
      opacity: PANEL_OPACITY,
      side: THREE.DoubleSide,
    });
    this.backgroundMesh = new THREE.Mesh(bgGeo, bgMat);
    this.group.add(this.backgroundMesh);

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
    const titleTextGeo = new THREE.PlaneGeometry(width * 0.72, TITLE_BAR_HEIGHT * 0.8);
    this.titleTextMesh = new THREE.Mesh(titleTextGeo, titleTextMat);
    this.titleTextMesh.position.set(-width * 0.06, height / 2 - TITLE_BAR_HEIGHT / 2, 0.002);
    this.group.add(this.titleTextMesh);

    const closeTex = createTextTexture('X', {
      fontSize: 22,
      color: '#ffffff',
      width: 64,
      height: 64,
    });
    const closeMat = new THREE.MeshBasicMaterial({
      map: closeTex,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const closeGeo = new THREE.PlaneGeometry(CLOSE_BUTTON_SIZE, CLOSE_BUTTON_SIZE);
    this.closeButtonMesh = new THREE.Mesh(closeGeo, closeMat);
    this.closeButtonMesh.position.set(
      width / 2 - CLOSE_BUTTON_SIZE * 0.8,
      height / 2 - TITLE_BAR_HEIGHT / 2,
      0.003
    );
    this.closeButtonMesh.visible = this.showCloseButton;
    this.group.add(this.closeButtonMesh);

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

    const contentHeight = height - TITLE_BAR_HEIGHT;
    if (this.panelCanvas) {
      this.panelCanvas.resizeMesh(width, contentHeight);
    } else {
      this.panelCanvas = new PanelCanvas(width, contentHeight);
    }
    this.panelCanvas.contentMesh.position.set(0, -TITLE_BAR_HEIGHT / 2, 0.002);
    if (!this.panelCanvas.contentMesh.parent) {
      this.group.add(this.panelCanvas.contentMesh);
    }
  }

  get isOpen(): boolean { return this._isOpen; }
  get isResizing(): boolean { return this._isResizing; }
  get isGrabbed(): boolean { return this._isGrabbed; }

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
    this.updateTargetLine();
  }

  openAtWorldPose(position: Vec3, quaternion?: Vec4): void {
    this.group.visible = true;
    this._isOpen = true;
    this.buildContent();
    this.setWorldPose(position, quaternion);
    this.updateTargetLine();
  }

  close(): void {
    this.group.visible = false;
    this._isOpen = false;
    this._isGrabbed = false;
    this._isResizing = false;
    this.activeWidget = null;
    if (this.targetLine) {
      this.targetLine.visible = false;
    }
  }

  toggle(position: Vec3, faceToward?: Vec3): void {
    if (this._isOpen) {
      this.close();
    } else {
      this.open(position, faceToward);
    }
  }

  getWorldPosition(): Vec3 {
    const world = new THREE.Vector3();
    this.group.getWorldPosition(world);
    return [world.x, world.y, world.z];
  }

  getWorldQuaternion(): Vec4 {
    const world = new THREE.Quaternion();
    this.group.getWorldQuaternion(world);
    return [world.x, world.y, world.z, world.w];
  }

  setWorldPose(position: Vec3, quaternion?: Vec4): void {
    const worldPos = new THREE.Vector3(position[0], position[1], position[2]);
    const localPos = this.parentObj.worldToLocal(worldPos);
    this.group.position.copy(localPos);

    if (quaternion) {
      const worldQuat = new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
      const parentQuat = new THREE.Quaternion();
      this.parentObj.getWorldQuaternion(parentQuat);
      const localQuat = parentQuat.clone().invert().multiply(worldQuat);
      this.group.quaternion.copy(localQuat);
    }

    this.updateTargetLine();
  }

  releaseGrab(): void {
    this._isGrabbed = false;
  }

  rayHitTest(raycaster: THREE.Raycaster): 'close' | 'title' | 'resize' | 'body' | null {
    if (!this._isOpen) return null;

    if (this.showCloseButton && this.closeButtonMesh.visible) {
      const closeHits = raycaster.intersectObject(this.closeButtonMesh);
      if (closeHits.length > 0) return 'close';
    }

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

    const parentWorldQuat = new THREE.Quaternion();
    this.parentObj.getWorldQuaternion(parentWorldQuat);

    const localHit = this.parentObj.worldToLocal(hits[0].point.clone());
    const worldOffset = this.group.position.clone().sub(localHit);

    if (controllerRotation) {
      const controllerQuat = new THREE.Quaternion(...controllerRotation);
      const localControllerQuat = parentWorldQuat.clone().invert().multiply(controllerQuat);
      this.grabOffset.copy(worldOffset.applyQuaternion(localControllerQuat.clone().invert()));
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

      const rotatedOffset = this.grabOffset.clone().applyQuaternion(localControllerQuat);
      this.group.position.copy(localPoint.add(rotatedOffset));
      this.group.quaternion.copy(localControllerQuat.clone().multiply(this._grabQuatOffset));
    } else {
      this.group.position.copy(localPoint.add(this.grabOffset));
    }

    this.updateTargetLine();
  }

  beginResize(raycaster: THREE.Raycaster): boolean {
    if (!this._isOpen) return false;
    const hits = raycaster.intersectObject(this.resizeHandleMesh);
    if (hits.length === 0) return false;

    this._isResizing = true;
    this.resizeGrabDistance = hits[0].distance;
    this.resizeStartWidth = this.width;
    this.resizeStartHeight = this.height;

    const invMatrix = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    this.resizeStartLocal.copy(hits[0].point).applyMatrix4(invMatrix);
    return true;
  }

  updateResize(raycaster: THREE.Raycaster): void {
    if (!this._isResizing) return;

    const worldPoint = new THREE.Vector3();
    raycaster.ray.at(this.resizeGrabDistance, worldPoint);

    const invMatrix = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const localPoint = worldPoint.applyMatrix4(invMatrix);

    const dx = localPoint.x - this.resizeStartLocal.x;
    const dy = localPoint.y - this.resizeStartLocal.y;

    const newWidth = Math.max(MIN_WIDTH, this.resizeStartWidth + dx);
    const newHeight = Math.max(MIN_HEIGHT, this.resizeStartHeight - dy);

    this.resize(newWidth, newHeight);
  }

  endResize(): void {
    this._isResizing = false;
  }

  resize(newWidth: number, newHeight: number): void {
    this.width = newWidth;
    this.height = newHeight;
    this.buildPanelMeshes();
    this.buildContent();
    this.updateTargetLine();
  }

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

    const hit = this.panelCanvas.hitTest(raycaster);
    if (!hit) return false;

    if (hit.widget.onPointerDown?.(hit.localX, hit.localY)) {
      this.activeWidget = hit.widget;
      this.panelCanvas.markDirty();
      return true;
    }

    this.panelCanvas.markDirty();
    return true;
  }

  isDraggingControl(): boolean {
    return this.activeWidget !== null;
  }

  updateCanvas(): void {
    this.panelCanvas.updateTexture();
  }

  updateTargetLine(): void {
    if (!this.targetLineEnabled || !this.targetObject || !this._isOpen) {
      if (this.targetLine) this.targetLine.visible = false;
      return;
    }

    const startLocal = new THREE.Vector3(0, -TITLE_BAR_HEIGHT, 0.01);
    const startWorld = this.group.localToWorld(startLocal);
    const endWorld = new THREE.Vector3();
    this.targetObject.getWorldPosition(endWorld);
    const midpoint = startWorld.clone().lerp(endWorld, 0.5);
    midpoint.y += Math.max(0.08, Math.abs(startWorld.y - endWorld.y) * 0.3);

    const curve = new THREE.QuadraticBezierCurve3(startWorld, midpoint, endWorld);
    const points = curve.getPoints(12).map((point) => this.parentObj.worldToLocal(point.clone()));

    if (!this.targetLine) {
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: TARGET_LINE_COLOR,
        transparent: true,
        opacity: 0.8,
      });
      this.targetLine = new THREE.Line(geometry, material);
      this.parentObj.add(this.targetLine);
    } else {
      this.targetLine.geometry.dispose();
      this.targetLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
    }

    this.targetLine.visible = true;
  }

  protected abstract buildContent(): void;
  abstract updateContent(): void;

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
    this.closeButtonMesh.geometry.dispose();
    (this.closeButtonMesh.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.closeButtonMesh.material as THREE.Material).dispose();
    if (this.targetLine) {
      this.parentObj.remove(this.targetLine);
      this.targetLine.geometry.dispose();
      (this.targetLine.material as THREE.Material).dispose();
      this.targetLine = null;
    }
    this.panelCanvas.dispose();
  }
}
