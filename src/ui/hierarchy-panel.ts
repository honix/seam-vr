// Hierarchy panel - scene tree view with lightweight node creation.

import * as THREE from 'three';
import { FloatingPanel } from './floating-panel';
import { SCENE_ROOT_ID, SceneGraph, SceneNode } from '../core/scene-graph';
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

export interface HierarchyRow {
  nodeId: string;
  text: string;
  icon: string;
  selected: boolean;
}

function formatTreePrefix(ancestorHasNext: boolean[], isLast: boolean): string {
  const prefix = ancestorHasNext.map((hasNext) => (hasNext ? '\u2502  ' : '   ')).join('');
  return `${prefix}${isLast ? '\u2514\u2500 ' : '\u251c\u2500 '}`;
}

export function buildHierarchyRows(root: SceneNode, selectedNodeId: string | null): HierarchyRow[] {
  const rows: HierarchyRow[] = [
    {
      nodeId: SCENE_ROOT_ID,
      text: 'Scene Root',
      icon: '\u25ce',
      selected: selectedNodeId === SCENE_ROOT_ID,
    },
  ];

  const visit = (node: SceneNode, ancestorHasNext: boolean[]): void => {
    node.children.forEach((child, index) => {
      const isLast = index === node.children.length - 1;
      const icon = TYPE_ICONS[child.layerType] ?? '\u25a0';
      const vis = child.visible ? '' : ' [hidden]';
      rows.push({
        nodeId: child.id,
        text: `${formatTreePrefix(ancestorHasNext, isLast)}${child.id}${vis}`,
        icon,
        selected: child.id === selectedNodeId,
      });
      visit(child, [...ancestorHasNext, !isLast]);
    });
  };

  visit(root, []);
  return rows;
}

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
    const rows = buildHierarchyRows(this.sceneGraph.getRoot(), this.selectedNodeId);

    rows.forEach((row, rowIndex) => {
      this.panelCanvas.addWidget(
        new ClickableRowWidget(PAD_X, rowY + rowIndex * ROW_H, contentW, ROW_H, {
          text: row.text,
          icon: row.icon,
          selected: row.selected,
          indent: row.nodeId === SCENE_ROOT_ID ? 0 : INDENT_PX / 2,
          onClick: () => {
            this.onSelectCallback?.(row.nodeId);
          },
        })
      );
    });

    if (rows.length === 1) {
      this.panelCanvas.addWidget(
        new LabelWidget(PAD_X, rowY + ROW_H + 10, contentW, ROW_H, { text: '(empty scene)', color: '#888888' })
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
