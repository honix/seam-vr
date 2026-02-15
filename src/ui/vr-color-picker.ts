// VR Color Picker - HSV wheel + brightness bar for color selection

import * as THREE from 'three';
import { createTextTexture } from './canvas-text';

export interface VRColorPickerConfig {
  label?: string;
  color?: [number, number, number];
  onChange?: (color: [number, number, number]) => void;
}

const WHEEL_RADIUS = 0.04;
const WHEEL_TEX_SIZE = 256;
const BAR_WIDTH = 0.012;
const BAR_HEIGHT = 0.08;
const SWATCH_SIZE = 0.015;

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, v];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    case 5: return [v, p, q];
    default: return [v, t, p];
  }
}

export class VRColorPicker {
  public group: THREE.Group = new THREE.Group();
  public onChange: ((color: [number, number, number]) => void) | null;

  private wheelMesh: THREE.Mesh;
  private barMesh: THREE.Mesh;
  private swatchMesh: THREE.Mesh;
  private labelMesh: THREE.Mesh | null = null;

  private wheelCanvas: HTMLCanvasElement;
  private wheelTexture: THREE.CanvasTexture;

  private h = 0;
  private s = 1;
  private v = 1;

  constructor(config: VRColorPickerConfig) {
    this.onChange = config.onChange ?? null;

    // HSV wheel
    this.wheelCanvas = document.createElement('canvas');
    this.wheelCanvas.width = WHEEL_TEX_SIZE;
    this.wheelCanvas.height = WHEEL_TEX_SIZE;
    this.wheelTexture = new THREE.CanvasTexture(this.wheelCanvas);

    const wheelGeo = new THREE.CircleGeometry(WHEEL_RADIUS, 48);
    const wheelMat = new THREE.MeshBasicMaterial({
      map: this.wheelTexture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.wheelMesh = new THREE.Mesh(wheelGeo, wheelMat);
    this.group.add(this.wheelMesh);

    // Brightness bar (to the right of wheel)
    const barCanvas = document.createElement('canvas');
    barCanvas.width = 32;
    barCanvas.height = 256;
    const barCtx = barCanvas.getContext('2d')!;
    const grad = barCtx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#000000');
    barCtx.fillStyle = grad;
    barCtx.fillRect(0, 0, 32, 256);
    const barTex = new THREE.CanvasTexture(barCanvas);

    const barGeo = new THREE.PlaneGeometry(BAR_WIDTH, BAR_HEIGHT);
    const barMat = new THREE.MeshBasicMaterial({
      map: barTex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.barMesh = new THREE.Mesh(barGeo, barMat);
    this.barMesh.position.set(WHEEL_RADIUS + BAR_WIDTH / 2 + 0.01, 0, 0);
    this.group.add(this.barMesh);

    // Preview swatch (below bar)
    const swatchGeo = new THREE.PlaneGeometry(SWATCH_SIZE, SWATCH_SIZE);
    const swatchMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.swatchMesh = new THREE.Mesh(swatchGeo, swatchMat);
    this.swatchMesh.position.set(
      WHEEL_RADIUS + BAR_WIDTH / 2 + 0.01,
      -BAR_HEIGHT / 2 - SWATCH_SIZE / 2 - 0.005,
      0,
    );
    this.group.add(this.swatchMesh);

    // Optional label
    if (config.label) {
      const labelTex = createTextTexture(config.label, {
        fontSize: 20,
        color: '#cccccc',
        width: 256,
        height: 24,
        align: 'center',
      });
      const labelMat = new THREE.MeshBasicMaterial({
        map: labelTex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const labelGeo = new THREE.PlaneGeometry(WHEEL_RADIUS * 2, 0.012);
      this.labelMesh = new THREE.Mesh(labelGeo, labelMat);
      this.labelMesh.position.set(0, WHEEL_RADIUS + 0.012, 0);
      this.group.add(this.labelMesh);
    }

    // Set initial color
    if (config.color) {
      this.setColor(config.color[0], config.color[1], config.color[2]);
    } else {
      this.drawWheel();
      this.updateSwatch();
    }
  }

  rayTestWheel(raycaster: THREE.Raycaster): { h: number; s: number } | null {
    const intersects = raycaster.intersectObject(this.wheelMesh);
    if (intersects.length === 0) return null;

    const local = this.wheelMesh.worldToLocal(intersects[0].point.clone());
    const angle = Math.atan2(local.y, local.x); // -PI to PI
    const hue = ((angle / (Math.PI * 2)) + 1) % 1; // normalize to 0-1
    const dist = Math.sqrt(local.x * local.x + local.y * local.y);
    const sat = Math.min(1, dist / WHEEL_RADIUS);

    return { h: hue, s: sat };
  }

  rayTestBrightness(raycaster: THREE.Raycaster): number | null {
    const intersects = raycaster.intersectObject(this.barMesh);
    if (intersects.length === 0) return null;

    const local = this.barMesh.worldToLocal(intersects[0].point.clone());
    // Map local Y from [-BAR_HEIGHT/2, BAR_HEIGHT/2] to [0, 1]
    // Top = bright (1), bottom = dark (0)
    const t = (local.y + BAR_HEIGHT / 2) / BAR_HEIGHT;
    return Math.max(0, Math.min(1, t));
  }

  setColor(r: number, g: number, b: number): void {
    [this.h, this.s, this.v] = rgbToHsv(r, g, b);
    this.drawWheel();
    this.updateSwatch();
  }

  getColor(): [number, number, number] {
    return hsvToRgb(this.h, this.s, this.v);
  }

  setHSV(h: number, s: number, v: number): void {
    this.h = h;
    this.s = s;
    this.v = v;
    this.drawWheel();
    this.updateSwatch();
    if (this.onChange) {
      this.onChange(this.getColor());
    }
  }

  private drawWheel(): void {
    const ctx = this.wheelCanvas.getContext('2d')!;
    const size = WHEEL_TEX_SIZE;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2;
    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (y * size + x) * 4;

        if (dist <= radius) {
          const angle = Math.atan2(dy, dx);
          const hue = ((angle / (Math.PI * 2)) + 1) % 1;
          const sat = dist / radius;
          const [r, g, b] = hsvToRgb(hue, sat, this.v);
          data[idx] = Math.round(r * 255);
          data[idx + 1] = Math.round(g * 255);
          data[idx + 2] = Math.round(b * 255);
          data[idx + 3] = 255;
        } else {
          data[idx + 3] = 0;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
    this.wheelTexture.needsUpdate = true;
  }

  private updateSwatch(): void {
    const [r, g, b] = this.getColor();
    (this.swatchMesh.material as THREE.MeshBasicMaterial).color.setRGB(r, g, b);
  }

  dispose(): void {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const mat = child.material as THREE.MeshBasicMaterial;
        if (mat.map) mat.map.dispose();
        mat.dispose();
      }
    });
  }
}
