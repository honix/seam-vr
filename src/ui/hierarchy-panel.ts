// Hierarchy panel - scene tree view with lightweight node creation.

import * as THREE from 'three';
import { FloatingPanel } from './floating-panel';
import { SceneGraph, SceneNode } from '../core/scene-graph';
import { ButtonWidget, ClickableRowWidget, LabelWidget } from './widgets';

const ROW_H = 28;
const BUTTON_H = 26;
const BUTTON_GAP = 6;
const INDENT_PX = 20;
const PAD_X = 8;
const CREATE_TOP_PAD = 6;

const TYPE_ICONS: Record<string, string> = {
  primitive: '\u25A0',
  clay: '\u25C9',
  light: '\u2600',
  group: '\u25B7',
  animation_player: '\u266B',
};

const CREATE_BUTTONS: Array<{ id: string; label: string }> = [
  { id: 'clay', label: 'Clay' },
  { id: 'group', label: 'Group' },
  { id: 'animation_player', label: 'Anim' },
  { id: 'cube', label: 'Cube' },
  { id: 'sphere', label: 'Sphere' },
  { id: 'capsule', label: 'Capsule' },
  { id: 'light', label: 'Light' },
];

export class HierarchyPanel extends FloatingPanel {
  readonly panelKind = 'hierarchy';

  private sceneGraph: SceneGraph;
  private onSelectCallback: ((nodeId: string) => void) | null = null;
  private onCreateCallback: ((kind: string) => void) | null = null;
  private selectedNodeId: string | null = null;

  constructor(parent: THREE.Object3D, sceneGraph: SceneGraph) {
    super(parent, 'Hierarchy', 0.32, 0.48);
    this.sceneGraph = sceneGraph;

    this.sceneGraph.on('node:added', () => {
      if (this.isOpen) this.updateContent();
    });
    this.sceneGraph.on('node:removed', () => {
      if (this.isOpen) this.updateContent();
    });
    this.sceneGraph.on('node:updated', () => {
      if (this.isOpen) this.updateContent();
    });
  }

  onSelect(callback: (nodeId: string) => void): void {
    this.onSelectCallback = callback;
  }

  onCreate(callback: (kind: string) => void): void {
    this.onCreateCallback = callback;
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

    let rowY = this.buildCreateRows(contentW);
    const root = this.sceneGraph.getRoot();
    let rowIndex = 0;

    const visit = (node: SceneNode, depth: number) => {
      for (const child of node.children) {
        const icon = TYPE_ICONS[child.layerType] ?? '\u25A0';
        const vis = child.visible ? '' : ' [hidden]';
        const label = `${child.id}${vis}`;
        const selected = child.id === this.selectedNodeId;
        const nodeId = child.id;

        this.panelCanvas.addWidget(
          new ClickableRowWidget(PAD_X, rowY + rowIndex * ROW_H, contentW, ROW_H, {
            text: label,
            icon,
            selected,
            indent: depth * INDENT_PX,
            onClick: () => {
              this.onSelectCallback?.(nodeId);
            },
          })
        );

        rowIndex++;
        visit(child, depth + 1);
      }
    };

    visit(root, 0);

    if (rowIndex === 0) {
      this.panelCanvas.addWidget(
        new LabelWidget(PAD_X, rowY + 10, contentW, ROW_H, { text: '(empty scene)', color: '#888888' })
      );
    }

    this.panelCanvas.markDirty();
  }

  private buildCreateRows(contentW: number): number {
    const cols = 3;
    const buttonW = (contentW - BUTTON_GAP * (cols - 1)) / cols;

    for (let i = 0; i < CREATE_BUTTONS.length; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = PAD_X + col * (buttonW + BUTTON_GAP);
      const y = CREATE_TOP_PAD + row * (BUTTON_H + BUTTON_GAP);
      const button = CREATE_BUTTONS[i];

      this.panelCanvas.addWidget(
        new ButtonWidget(x, y, buttonW, BUTTON_H, {
          text: button.label,
          onClick: () => {
            this.onCreateCallback?.(button.id);
          },
        })
      );
    }

    return CREATE_TOP_PAD + Math.ceil(CREATE_BUTTONS.length / 3) * (BUTTON_H + BUTTON_GAP) + 8;
  }
}
