// Hierarchy panel - shows layer tree view.
// Lists all layers with indentation for parent-child relationships.
// Trigger on a row selects that layer.

import * as THREE from 'three';
import { FloatingPanel } from './floating-panel';
import { SceneGraph, SceneNode } from '../core/scene-graph';
import { createTextTexture } from './canvas-text';

const LINE_HEIGHT = 0.022;
const FONT_SIZE = 18;
const INDENT = 0.015;

const TYPE_ICONS: Record<string, string> = {
  primitive: '\u25A0',  // filled square
  sculpt: '\u25C9',     // circle with dot
  light: '\u2600',      // sun
  group: '\u25B7',      // triangle right
};

export class HierarchyPanel extends FloatingPanel {
  private sceneGraph: SceneGraph;
  private contentMeshes: THREE.Mesh[] = [];
  private rowNodes: SceneNode[] = [];
  private onSelectCallback: ((nodeId: string) => void) | null = null;
  private selectedNodeId: string | null = null;

  constructor(scene: THREE.Scene, sceneGraph: SceneGraph) {
    super(scene, 'Hierarchy', 0.25, 0.4);
    this.sceneGraph = sceneGraph;
  }

  onSelect(callback: (nodeId: string) => void): void {
    this.onSelectCallback = callback;
  }

  setSelectedNodeId(id: string | null): void {
    this.selectedNodeId = id;
    if (this.isOpen) {
      this.updateContent();
    }
  }

  /**
   * Try to select a layer by proximity to a row.
   * Returns true if a layer was selected.
   */
  trySelect(pointerPosition: [number, number, number]): boolean {
    if (!this.isOpen || this.rowNodes.length === 0) return false;

    const pointer = new THREE.Vector3(...pointerPosition);
    const invMatrix = this.group.matrixWorld.clone().invert();
    const localPt = pointer.clone().applyMatrix4(invMatrix);

    // Find which row the pointer is closest to
    const startY = this.height / 2 - 0.05;
    const row = Math.round((startY - localPt.y) / LINE_HEIGHT);

    if (row >= 0 && row < this.rowNodes.length && Math.abs(localPt.x) < this.width / 2) {
      const node = this.rowNodes[row];
      this.onSelectCallback?.(node.id);
      return true;
    }
    return false;
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
    this.rowNodes = [];

    let row = 0;
    const root = this.sceneGraph.getRoot();

    // Recursive traversal with indentation
    const visit = (node: SceneNode, depth: number) => {
      for (const child of node.children) {
        const icon = TYPE_ICONS[child.layerType] ?? '\u25A0';
        const vis = child.visible ? '' : ' [hidden]';
        const label = `${icon} ${child.id}${vis}`;
        const selected = child.id === this.selectedNodeId;
        this.addLine(label, row, depth, selected);
        this.rowNodes.push(child);
        row++;
        visit(child, depth + 1);
      }
    };

    visit(root, 0);

    if (row === 0) {
      this.addLine('(empty scene)', 0, 0);
    }
  }

  private addLine(text: string, row: number, depth: number, selected = false): void {
    const textColor = selected ? '#ff8800' : '#cccccc';
    const tex = createTextTexture(text, {
      fontSize: FONT_SIZE,
      color: textColor,
      width: 256,
      height: 22,
      align: 'left',
    });
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(this.width * 0.85, LINE_HEIGHT * 0.85);
    const mesh = new THREE.Mesh(geo, mat);

    const startY = this.height / 2 - 0.05;
    const xOffset = -this.width / 2 + 0.02 + depth * INDENT + this.width * 0.85 / 2;
    mesh.position.set(xOffset, startY - row * LINE_HEIGHT, 0);

    // Selected row background highlight
    if (selected) {
      const bgGeo = new THREE.PlaneGeometry(this.width * 0.9, LINE_HEIGHT);
      const bgMat = new THREE.MeshBasicMaterial({
        color: 0x3a2a0e,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const bgMesh = new THREE.Mesh(bgGeo, bgMat);
      bgMesh.position.set(0, startY - row * LINE_HEIGHT, -0.001);
      this.contentGroup.add(bgMesh);
      this.contentMeshes.push(bgMesh);
    }

    this.contentGroup.add(mesh);
    this.contentMeshes.push(mesh);
  }
}
