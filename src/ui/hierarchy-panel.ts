// Hierarchy panel - shows layer tree view.
// Content rendered via Canvas 2D ClickableRowWidgets on PanelCanvas.

import * as THREE from 'three';
import { FloatingPanel } from './floating-panel';
import { SceneGraph, SceneNode } from '../core/scene-graph';
import { ClickableRowWidget, LabelWidget } from './widgets';

const ROW_H = 28;
const INDENT_PX = 20;
const PAD_X = 8;

const TYPE_ICONS: Record<string, string> = {
  primitive: '\u25A0',  // filled square
  sculpt: '\u25C9',     // circle with dot
  light: '\u2600',      // sun
  group: '\u25B7',      // triangle right
};

export class HierarchyPanel extends FloatingPanel {
  private sceneGraph: SceneGraph;
  private onSelectCallback: ((nodeId: string) => void) | null = null;
  private selectedNodeId: string | null = null;

  constructor(parent: THREE.Object3D, sceneGraph: SceneGraph) {
    super(parent, 'Hierarchy', 0.25, 0.4);
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

  protected buildContent(): void {
    this.updateContent();
  }

  updateContent(): void {
    this.panelCanvas.clearWidgets();
    const cw = this.panelCanvas.canvasWidth;
    const contentW = cw - PAD_X * 2;

    let row = 0;
    const root = this.sceneGraph.getRoot();

    const visit = (node: SceneNode, depth: number) => {
      for (const child of node.children) {
        const icon = TYPE_ICONS[child.layerType] ?? '\u25A0';
        const vis = child.visible ? '' : ' [hidden]';
        const label = `${child.id}${vis}`;
        const selected = child.id === this.selectedNodeId;
        const nodeId = child.id;

        this.panelCanvas.addWidget(
          new ClickableRowWidget(PAD_X, row * ROW_H + 4, contentW, ROW_H, {
            text: label,
            icon,
            selected,
            indent: depth * INDENT_PX,
            onClick: () => {
              this.onSelectCallback?.(nodeId);
            },
          })
        );

        row++;
        visit(child, depth + 1);
      }
    };

    visit(root, 0);

    if (row === 0) {
      this.panelCanvas.addWidget(
        new LabelWidget(PAD_X, 10, contentW, ROW_H, { text: '(empty scene)', color: '#888888' })
      );
    }

    this.panelCanvas.markDirty();
  }

  override dispose(): void {
    super.dispose();
  }
}
