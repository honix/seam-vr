// Inspector panel - shows and edits properties of the selected layer.
// Interactive controls: sliders, color pickers, dropdowns per node type.

import * as THREE from 'three';
import { FloatingPanel } from './floating-panel';
import { SceneNode } from '../core/scene-graph';
import { CommandBus } from '../core/command-bus';
import { VRSlider } from './vr-slider';
import { VRColorPicker } from './vr-color-picker';
import { VRDropdown } from './vr-dropdown';
import { createTextTexture } from './canvas-text';
import type { SculptEngine } from '../sculpting/sculpt-engine';

const LINE_HEIGHT = 0.025;
const FONT_SIZE = 20;

export class InspectorPanel extends FloatingPanel {
  private selectedNode: SceneNode | null = null;
  private contentMeshes: THREE.Mesh[] = [];

  // Interactive controls
  private sliders: VRSlider[] = [];
  private colorPickers: VRColorPicker[] = [];
  private dropdowns: VRDropdown[] = [];
  private _isDragging = false;

  // Dependencies
  private commandBus: CommandBus | null = null;
  private sculptEngine: SculptEngine | null = null;

  constructor(scene: THREE.Scene) {
    super(scene, 'Inspector', 0.25, 0.45);
  }

  setCommandBus(bus: CommandBus): void {
    this.commandBus = bus;
  }

  setSculptEngine(engine: SculptEngine): void {
    this.sculptEngine = engine;
  }

  setSelectedNode(node: SceneNode | null): void {
    this.selectedNode = node;
    if (this.isOpen) {
      this.updateContent();
    }
  }

  protected buildContent(): void {
    this.updateContent();
  }

  updateContent(): void {
    // Clear existing content
    this.clearControls();

    if (!this.selectedNode) {
      this.addLine('No layer selected', 0);
      return;
    }

    const node = this.selectedNode;
    let row = 0;

    this.addLine(`Name: ${node.id}`, row++);
    this.addLine(`Type: ${node.nodeType}`, row++);
    row++; // spacer

    if (node.layerType === 'primitive') {
      this.buildPrimitiveControls(node, row);
    } else if (node.layerType === 'light') {
      this.buildLightControls(node, row);
    } else if (node.nodeType === 'sculpt_volume') {
      this.buildSculptControls(row);
    }
  }

  private buildPrimitiveControls(node: SceneNode, startRow: number): void {
    let row = startRow;

    // Color picker
    this.addLine('Color', row++);
    const colorPicker = new VRColorPicker({
      color: [...node.material.color] as [number, number, number],
      onChange: (color) => {
        this.commandBus?.exec({
          cmd: 'set_material',
          id: node.id,
          material: { color },
        });
      },
    });
    this.addControl(colorPicker.group, row, 0.1);
    this.colorPickers.push(colorPicker);
    row += 5; // color picker takes ~5 rows of space

    // Roughness slider
    const roughnessSlider = new VRSlider({
      label: 'Roughness',
      min: 0,
      max: 1,
      value: node.material.roughness,
      width: 0.18,
      onChange: (value) => {
        this.commandBus?.exec({
          cmd: 'set_material',
          id: node.id,
          material: { roughness: value },
        });
      },
    });
    this.addControl(roughnessSlider.group, row, 0.04);
    this.sliders.push(roughnessSlider);
  }

  private buildLightControls(node: SceneNode, startRow: number): void {
    if (!node.lightData) return;
    let row = startRow;

    // Light type dropdown
    const typeDropdown = new VRDropdown({
      label: 'Type',
      options: ['point', 'directional', 'spot'],
      selectedIndex: ['point', 'directional', 'spot'].indexOf(node.lightData.type),
      width: 0.18,
      onChange: (index) => {
        const types = ['point', 'directional', 'spot'];
        this.commandBus?.exec({
          cmd: 'set_light_param',
          id: node.id,
          lightType: types[index],
        });
      },
    });
    this.addControl(typeDropdown.group, row, 0.03);
    this.dropdowns.push(typeDropdown);
    row += 2;

    // Color picker
    this.addLine('Color', row++);
    const colorPicker = new VRColorPicker({
      color: [...node.lightData.color] as [number, number, number],
      onChange: (color) => {
        this.commandBus?.exec({
          cmd: 'set_light_param',
          id: node.id,
          color,
        });
      },
    });
    this.addControl(colorPicker.group, row, 0.1);
    this.colorPickers.push(colorPicker);
    row += 5;

    // Intensity slider
    const intensitySlider = new VRSlider({
      label: 'Intensity',
      min: 0,
      max: 50,
      value: node.lightData.intensity,
      width: 0.18,
      onChange: (value) => {
        this.commandBus?.exec({
          cmd: 'set_light_param',
          id: node.id,
          intensity: value,
        });
      },
    });
    this.addControl(intensitySlider.group, row, 0.04);
    this.sliders.push(intensitySlider);
  }

  private buildSculptControls(startRow: number): void {
    if (!this.sculptEngine) return;
    let row = startRow;

    // Color tint picker
    this.addLine('Color Tint', row++);
    const mat = this.sculptEngine.sculptMaterial;
    const colorPicker = new VRColorPicker({
      color: [mat.color.r, mat.color.g, mat.color.b],
      onChange: (color) => {
        if (this.sculptEngine) {
          this.sculptEngine.sculptMaterial.color.setRGB(color[0], color[1], color[2]);
        }
      },
    });
    this.addControl(colorPicker.group, row, 0.1);
    this.colorPickers.push(colorPicker);
    row += 5;

    // Roughness slider
    const roughnessSlider = new VRSlider({
      label: 'Roughness',
      min: 0,
      max: 1,
      value: mat.roughness,
      width: 0.18,
      onChange: (value) => {
        if (this.sculptEngine) {
          this.sculptEngine.sculptMaterial.roughness = value;
        }
      },
    });
    this.addControl(roughnessSlider.group, row, 0.04);
    this.sliders.push(roughnessSlider);
  }

  // --- Ray interaction for interactive controls ---

  override rayInteract(raycaster: THREE.Raycaster, phase: 'start' | 'update' | 'end'): boolean {
    if (phase === 'end') {
      this._isDragging = false;
      return false;
    }

    // Test sliders
    for (const slider of this.sliders) {
      const t = slider.rayTest(raycaster);
      if (t !== null) {
        slider.setNormalized(t);
        if (phase === 'start') this._isDragging = true;
        return true;
      }
    }

    // Test color pickers
    for (const picker of this.colorPickers) {
      const wheelHit = picker.rayTestWheel(raycaster);
      if (wheelHit) {
        if (phase === 'start') this._isDragging = true;
        return true;
      }
      const barHit = picker.rayTestBrightness(raycaster);
      if (barHit !== null) {
        if (phase === 'start') this._isDragging = true;
        return true;
      }
    }

    // Test dropdowns
    for (const dropdown of this.dropdowns) {
      const hit = dropdown.rayTest(raycaster);
      if (hit !== null) {
        if (hit === 'header') {
          dropdown.toggle();
        } else {
          dropdown.select(hit);
        }
        return true;
      }
    }

    return false;
  }

  override isDraggingControl(): boolean {
    return this._isDragging;
  }

  // --- Helpers ---

  private addLine(text: string, row: number): void {
    const tex = createTextTexture(text, {
      fontSize: FONT_SIZE,
      color: '#cccccc',
      width: 256,
      height: 24,
      align: 'left',
    });
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(this.width * 0.9, LINE_HEIGHT * 0.8);
    const mesh = new THREE.Mesh(geo, mat);

    const startY = this.height / 2 - 0.05;
    mesh.position.set(0, startY - row * LINE_HEIGHT, 0);

    this.contentGroup.add(mesh);
    this.contentMeshes.push(mesh);
  }

  private addControl(group: THREE.Group, row: number, heightInRows: number): void {
    const startY = this.height / 2 - 0.05;
    group.position.set(0, startY - row * LINE_HEIGHT - heightInRows / 2, 0.003);
    this.contentGroup.add(group);
  }

  private clearControls(): void {
    // Clear text meshes
    for (const mesh of this.contentMeshes) {
      this.contentGroup.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.contentMeshes = [];

    // Remove and dispose interactive controls
    for (const slider of this.sliders) {
      this.contentGroup.remove(slider.group);
      slider.dispose();
    }
    this.sliders = [];

    for (const picker of this.colorPickers) {
      this.contentGroup.remove(picker.group);
      picker.dispose();
    }
    this.colorPickers = [];

    for (const dropdown of this.dropdowns) {
      this.contentGroup.remove(dropdown.group);
      dropdown.dispose();
    }
    this.dropdowns = [];

    this._isDragging = false;
  }

  override dispose(): void {
    this.clearControls();
    super.dispose();
  }
}
