// Inspector panel - shows properties of the selected layer.
// Read-only for now (editing via controller gestures is future work).

import * as THREE from 'three';
import { FloatingPanel } from './floating-panel';
import { SceneNode } from '../core/scene-graph';
import { createTextTexture } from './canvas-text';

const LINE_HEIGHT = 0.025;
const FONT_SIZE = 20;

export class InspectorPanel extends FloatingPanel {
  private selectedNode: SceneNode | null = null;
  private contentMeshes: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    super(scene, 'Inspector', 0.25, 0.35);
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
    for (const mesh of this.contentMeshes) {
      this.contentGroup.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.contentMeshes = [];

    if (!this.selectedNode) {
      this.addLine('No layer selected', 0);
      return;
    }

    const node = this.selectedNode;
    let row = 0;

    this.addLine(`Name: ${node.id}`, row++);
    this.addLine(`Type: ${node.nodeType}`, row++);
    this.addLine(`Layer: ${node.layerType}`, row++);
    row++; // spacer

    // Transform
    const p = node.transform.position;
    this.addLine(`Pos: ${p[0].toFixed(2)}, ${p[1].toFixed(2)}, ${p[2].toFixed(2)}`, row++);

    const s = node.transform.scale;
    this.addLine(`Scale: ${s[0].toFixed(2)}, ${s[1].toFixed(2)}, ${s[2].toFixed(2)}`, row++);

    // Material (for primitives)
    if (node.layerType === 'primitive') {
      row++;
      const c = node.material.color;
      this.addLine(`Color: ${c[0].toFixed(1)}, ${c[1].toFixed(1)}, ${c[2].toFixed(1)}`, row++);
      this.addLine(`Rough: ${node.material.roughness.toFixed(2)}`, row++);
    }

    // Light data
    if (node.lightData) {
      row++;
      this.addLine(`Light: ${node.lightData.type}`, row++);
      this.addLine(`Intensity: ${node.lightData.intensity.toFixed(1)}`, row++);
    }

    this.addLine(`Visible: ${node.visible}`, row++);
  }

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

    // Position from top of content area
    const startY = this.height / 2 - 0.05;
    mesh.position.set(0, startY - row * LINE_HEIGHT, 0);

    this.contentGroup.add(mesh);
    this.contentMeshes.push(mesh);
  }
}
