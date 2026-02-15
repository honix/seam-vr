// VR Slider - reusable slider control for floating panels

import * as THREE from 'three';
import { createTextTexture } from './canvas-text';

export interface VRSliderConfig {
  label: string;
  min: number;
  max: number;
  value: number;
  width?: number;
  height?: number;
  onChange?: (value: number) => void;
}

const TRACK_HEIGHT = 0.012;
const HANDLE_RADIUS = 0.006;

export class VRSlider {
  public group: THREE.Group = new THREE.Group();

  private trackMesh: THREE.Mesh;
  private fillMesh: THREE.Mesh;
  private handleMesh: THREE.Mesh;
  private labelMesh: THREE.Mesh;
  private valueMesh: THREE.Mesh;

  private trackWidth: number;
  private trackHeight: number;
  private min: number;
  private max: number;
  private normalized = 0;
  private onChange: ((value: number) => void) | null;

  constructor(config: VRSliderConfig) {
    this.trackWidth = config.width ?? 0.18;
    this.trackHeight = config.height ?? TRACK_HEIGHT;
    this.min = config.min;
    this.max = config.max;
    this.onChange = config.onChange ?? null;

    // Track background
    const trackGeo = new THREE.PlaneGeometry(this.trackWidth, this.trackHeight);
    const trackMat = new THREE.MeshBasicMaterial({
      color: 0x333333,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.trackMesh = new THREE.Mesh(trackGeo, trackMat);
    this.group.add(this.trackMesh);

    // Fill bar
    const fillGeo = new THREE.PlaneGeometry(this.trackWidth, this.trackHeight);
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xff8800,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.fillMesh = new THREE.Mesh(fillGeo, fillMat);
    this.fillMesh.position.z = 0.0005;
    this.group.add(this.fillMesh);

    // Handle disc
    const handleGeo = new THREE.CircleGeometry(HANDLE_RADIUS, 16);
    const handleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.handleMesh = new THREE.Mesh(handleGeo, handleMat);
    this.handleMesh.position.z = 0.001;
    this.group.add(this.handleMesh);

    // Label text (above track, left-aligned)
    const labelTex = createTextTexture(config.label, {
      fontSize: 20,
      color: '#cccccc',
      width: 256,
      height: 24,
      align: 'left',
    });
    const labelMat = new THREE.MeshBasicMaterial({
      map: labelTex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const labelGeo = new THREE.PlaneGeometry(this.trackWidth * 0.6, 0.012);
    this.labelMesh = new THREE.Mesh(labelGeo, labelMat);
    this.labelMesh.position.set(
      -this.trackWidth * 0.2,
      this.trackHeight / 2 + 0.01,
      0,
    );
    this.group.add(this.labelMesh);

    // Value text (above track, right-aligned)
    const valueTex = createTextTexture(this.formatValue(config.value), {
      fontSize: 20,
      color: '#ffffff',
      width: 128,
      height: 24,
      align: 'right',
    });
    const valueMat = new THREE.MeshBasicMaterial({
      map: valueTex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const valueGeo = new THREE.PlaneGeometry(this.trackWidth * 0.4, 0.012);
    this.valueMesh = new THREE.Mesh(valueGeo, valueMat);
    this.valueMesh.position.set(
      this.trackWidth * 0.3,
      this.trackHeight / 2 + 0.01,
      0,
    );
    this.group.add(this.valueMesh);

    // Set initial value
    this.setValue(config.value);
  }

  rayTest(raycaster: THREE.Raycaster): number | null {
    const intersects = raycaster.intersectObject(this.trackMesh);
    if (intersects.length === 0) return null;

    // Convert hit to local space of track
    const localPoint = this.trackMesh.worldToLocal(intersects[0].point.clone());
    // Map local X from [-trackWidth/2, trackWidth/2] to [0, 1]
    const t = (localPoint.x + this.trackWidth / 2) / this.trackWidth;
    return Math.max(0, Math.min(1, t));
  }

  setNormalized(t: number): void {
    this.normalized = Math.max(0, Math.min(1, t));

    // Update fill width and position
    const fillWidth = this.trackWidth * this.normalized;
    this.fillMesh.scale.x = this.normalized || 0.001; // avoid zero scale
    this.fillMesh.position.x = -this.trackWidth / 2 + fillWidth / 2;

    // Update handle position
    const handleX = -this.trackWidth / 2 + fillWidth;
    this.handleMesh.position.x = handleX;

    // Update value text
    this.updateValueText();

    if (this.onChange) {
      this.onChange(this.getValue());
    }
  }

  setValue(v: number): void {
    const range = this.max - this.min;
    const t = range === 0 ? 0 : (v - this.min) / range;
    this.setNormalized(t);
  }

  getValue(): number {
    return this.min + this.normalized * (this.max - this.min);
  }

  private formatValue(v: number): string {
    return Math.abs(v) >= 100 ? v.toFixed(0) :
      Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  }

  private updateValueText(): void {
    const oldMat = this.valueMesh.material as THREE.MeshBasicMaterial;
    if (oldMat.map) oldMat.map.dispose();
    oldMat.dispose();

    const tex = createTextTexture(this.formatValue(this.getValue()), {
      fontSize: 20,
      color: '#ffffff',
      width: 128,
      height: 24,
      align: 'right',
    });
    this.valueMesh.material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
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
