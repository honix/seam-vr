// PanelCanvas - offscreen Canvas 2D rendered to a single Three.js mesh via CanvasTexture.
// Manages virtual widgets, UV-based hit testing, and dirty-flag redraws.

import * as THREE from 'three';
import type { Widget } from './widgets';

const BG_COLOR = '#252540';
// Pixels per meter — controls canvas resolution. Higher = crisper text.
const PPM = 2048;

export class PanelCanvas {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  contentMesh: THREE.Mesh;
  widgets: Widget[] = [];
  dirty = true;

  private widthPx: number;
  private heightPx: number;

  constructor(meshWidth: number, meshHeight: number) {
    // Derive canvas pixel size from mesh dimensions to guarantee matching aspect ratio
    this.widthPx = Math.round(meshWidth * PPM);
    this.heightPx = Math.round(meshHeight * PPM);

    // Offscreen canvas (never added to DOM)
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.widthPx;
    this.canvas.height = this.heightPx;

    // CanvasTexture
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    // Single content mesh
    const geo = new THREE.PlaneGeometry(meshWidth, meshHeight);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.contentMesh = new THREE.Mesh(geo, mat);
    this.contentMesh.renderOrder = 1001;
  }

  get canvasWidth(): number { return this.widthPx; }
  get canvasHeight(): number { return this.heightPx; }

  addWidget(widget: Widget): void {
    this.widgets.push(widget);
    this.dirty = true;
  }

  clearWidgets(): void {
    this.widgets = [];
    this.dirty = true;
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Resize mesh geometry and canvas to match new 3D dimensions. */
  resizeMesh(meshWidth: number, meshHeight: number): void {
    this.widthPx = Math.round(meshWidth * PPM);
    this.heightPx = Math.round(meshHeight * PPM);

    this.canvas.width = this.widthPx;
    this.canvas.height = this.heightPx;

    // Replace geometry
    this.contentMesh.geometry.dispose();
    this.contentMesh.geometry = new THREE.PlaneGeometry(meshWidth, meshHeight);

    this.dirty = true;
  }

  redraw(): void {
    const ctx = this.canvas.getContext('2d')!;

    // Clear with panel background color
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, this.widthPx, this.heightPx);

    // Draw all widgets top to bottom
    for (const widget of this.widgets) {
      ctx.save();
      widget.draw(ctx);
      ctx.restore();
    }
  }

  updateTexture(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.redraw();
    this.texture.needsUpdate = true;
  }

  /**
   * Hit test: raycaster intersects the content mesh, UV → pixel coords → widget.
   * Returns the hit widget and the local pixel coordinates within the canvas.
   */
  hitTest(raycaster: THREE.Raycaster): { widget: Widget; localX: number; localY: number } | null {
    const hits = raycaster.intersectObject(this.contentMesh);
    if (hits.length === 0) return null;

    const uv = hits[0].uv;
    if (!uv) return null;

    // UV (0,0) is bottom-left in Three.js. Canvas (0,0) is top-left.
    const px = uv.x * this.widthPx;
    const py = (1 - uv.y) * this.heightPx;

    // Test widgets in reverse order (top-drawn widgets are last, get priority)
    for (let i = this.widgets.length - 1; i >= 0; i--) {
      const w = this.widgets[i];
      if (px >= w.x && px <= w.x + w.w && py >= w.y && py <= w.y + w.h) {
        return { widget: w, localX: px, localY: py };
      }
    }

    return null;
  }

  dispose(): void {
    this.contentMesh.geometry.dispose();
    (this.contentMesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
