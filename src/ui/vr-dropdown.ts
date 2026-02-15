// VR Dropdown - expandable option list for floating panels

import * as THREE from 'three';
import { createTextTexture } from './canvas-text';

export interface VRDropdownConfig {
  label: string;
  options: string[];
  selectedIndex?: number;
  width?: number;
  onChange?: (index: number) => void;
}

const ROW_HEIGHT = 0.022;
const HEADER_COLOR = 0x2a2a4e;
const OPTION_COLOR = 0x222244;
const SELECTED_COLOR = 0xff8800;

export class VRDropdown {
  public group: THREE.Group = new THREE.Group();

  private label: string;
  private options: string[];
  private selectedIndex: number;
  private expanded = false;
  private width: number;
  private onChange: ((index: number) => void) | null;

  private headerMesh: THREE.Mesh;
  private headerTextMesh: THREE.Mesh;
  private optionMeshes: THREE.Mesh[] = [];
  private optionTextMeshes: THREE.Mesh[] = [];

  constructor(config: VRDropdownConfig) {
    this.label = config.label;
    this.options = config.options;
    this.selectedIndex = config.selectedIndex ?? 0;
    this.width = config.width ?? 0.18;
    this.onChange = config.onChange ?? null;

    // Header background
    const headerGeo = new THREE.PlaneGeometry(this.width, ROW_HEIGHT);
    const headerMat = new THREE.MeshBasicMaterial({
      color: HEADER_COLOR,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.headerMesh = new THREE.Mesh(headerGeo, headerMat);
    this.group.add(this.headerMesh);

    // Header text
    const headerTextGeo = new THREE.PlaneGeometry(this.width * 0.9, ROW_HEIGHT * 0.8);
    const headerTextMat = new THREE.MeshBasicMaterial({
      map: this.makeHeaderTexture(),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.headerTextMesh = new THREE.Mesh(headerTextGeo, headerTextMat);
    this.headerTextMesh.position.z = 0.0005;
    this.group.add(this.headerTextMesh);
  }

  rayTest(raycaster: THREE.Raycaster): 'header' | number | null {
    // Test header
    const headerHits = raycaster.intersectObject(this.headerMesh);
    if (headerHits.length > 0) return 'header';

    // Test option rows if expanded
    if (this.expanded) {
      for (let i = 0; i < this.optionMeshes.length; i++) {
        const hits = raycaster.intersectObject(this.optionMeshes[i]);
        if (hits.length > 0) return i;
      }
    }

    return null;
  }

  select(index: number): void {
    if (index < 0 || index >= this.options.length) return;
    this.selectedIndex = index;
    this.expanded = false;
    this.rebuild();
    if (this.onChange) {
      this.onChange(index);
    }
  }

  toggle(): void {
    this.expanded = !this.expanded;
    this.rebuild();
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getSelectedValue(): string {
    return this.options[this.selectedIndex] ?? '';
  }

  private rebuild(): void {
    // Clear option meshes
    for (const mesh of this.optionMeshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (const mesh of this.optionTextMeshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }
    this.optionMeshes = [];
    this.optionTextMeshes = [];

    // Update header text
    const oldHeaderMat = this.headerTextMesh.material as THREE.MeshBasicMaterial;
    if (oldHeaderMat.map) oldHeaderMat.map.dispose();
    oldHeaderMat.dispose();
    this.headerTextMesh.material = new THREE.MeshBasicMaterial({
      map: this.makeHeaderTexture(),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });

    // Build option rows if expanded
    if (this.expanded) {
      for (let i = 0; i < this.options.length; i++) {
        const isSelected = i === this.selectedIndex;
        const yPos = -(i + 1) * ROW_HEIGHT;

        // Option background
        const optGeo = new THREE.PlaneGeometry(this.width, ROW_HEIGHT);
        const optMat = new THREE.MeshBasicMaterial({
          color: isSelected ? SELECTED_COLOR : OPTION_COLOR,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const optMesh = new THREE.Mesh(optGeo, optMat);
        optMesh.renderOrder = 1003;
        optMesh.position.set(0, yPos, 0);
        this.group.add(optMesh);
        this.optionMeshes.push(optMesh);

        // Option text
        const textTex = createTextTexture(this.options[i], {
          fontSize: 18,
          color: isSelected ? '#000000' : '#cccccc',
          width: 256,
          height: 24,
          align: 'left',
        });
        const textMat = new THREE.MeshBasicMaterial({
          map: textTex,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const textGeo = new THREE.PlaneGeometry(this.width * 0.85, ROW_HEIGHT * 0.75);
        const textMesh = new THREE.Mesh(textGeo, textMat);
        textMesh.renderOrder = 1003;
        textMesh.position.set(0, yPos, 0.0005);
        this.group.add(textMesh);
        this.optionTextMeshes.push(textMesh);
      }
    }
  }

  private makeHeaderTexture(): THREE.CanvasTexture {
    const selectedLabel = this.options[this.selectedIndex] ?? '';
    const arrow = this.expanded ? '\u25B2' : '\u25BC';
    const text = `${this.label}: ${selectedLabel} ${arrow}`;
    return createTextTexture(text, {
      fontSize: 18,
      color: '#ffffff',
      width: 256,
      height: 24,
      align: 'left',
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
