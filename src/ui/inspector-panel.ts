// Inspector panel - shows and edits properties of the selected node.

import * as THREE from 'three';
import { FloatingPanel } from './floating-panel';
import { SceneNode } from '../core/scene-graph';
import { CommandBus } from '../core/command-bus';
import {
  LabelWidget,
  SliderWidget,
  ColorWheelWidget,
  DropdownWidget,
} from './widgets';
import type { ClayManager } from '../sculpting/clay-manager';

const PAD_X = 10;
const ROW_H = 28;
const SLIDER_H = 52;
const COLOR_WHEEL_H = 150;
const DROPDOWN_H = 30;

export class InspectorPanel extends FloatingPanel {
  readonly panelKind = 'inspector';

  private selectedNode: SceneNode | null = null;
  private commandBus: CommandBus | null = null;
  private clayManager: ClayManager | null = null;

  constructor(parent: THREE.Object3D) {
    super(parent, 'Inspector', 0.26, 0.48);
  }

  setCommandBus(bus: CommandBus): void {
    this.commandBus = bus;
  }

  setClayManager(manager: ClayManager): void {
    this.clayManager = manager;
  }

  setSelectedNode(node: SceneNode | null): void {
    this.selectedNode = node;
    if (this.isOpen) {
      this.updateContent();
    }
  }

  getSelectedNode(): SceneNode | null {
    return this.selectedNode;
  }

  protected buildContent(): void {
    this.updateContent();
  }

  updateContent(): void {
    this.panelCanvas.clearWidgets();
    const cw = this.panelCanvas.canvasWidth;
    const contentW = cw - PAD_X * 2;

    if (!this.selectedNode) {
      this.panelCanvas.addWidget(
        new LabelWidget(PAD_X, 10, contentW, ROW_H, { text: 'No node selected', color: '#888888' })
      );
      this.panelCanvas.markDirty();
      return;
    }

    const node = this.selectedNode;
    let y = 10;

    this.panelCanvas.addWidget(
      new LabelWidget(PAD_X, y, contentW, ROW_H, { text: `Name: ${node.id}` })
    );
    y += ROW_H;

    this.panelCanvas.addWidget(
      new LabelWidget(PAD_X, y, contentW, ROW_H, { text: `Type: ${node.nodeType}` })
    );
    y += ROW_H + 8;

    switch (node.nodeType) {
      case 'light':
        y = this.buildLightWidgets(node, y, contentW);
        break;
      case 'clay':
        y = this.buildClayWidgets(node, y, contentW);
        break;
      case 'animation_player':
        y = this.buildAnimationPlayerWidgets(node, y, contentW);
        break;
      case 'group':
        this.panelCanvas.addWidget(
          new LabelWidget(PAD_X, y, contentW, ROW_H, {
            text: 'Group node for organization and parenting.',
            color: '#aaaaaa',
          })
        );
        break;
      default:
        y = this.buildPrimitiveWidgets(node, y, contentW);
        break;
    }

    this.panelCanvas.markDirty();
  }

  private buildPrimitiveWidgets(node: SceneNode, y: number, contentW: number): number {
    this.panelCanvas.addWidget(
      new LabelWidget(PAD_X, y, contentW, ROW_H, { text: 'Color', fontSize: 16, color: '#aaaaaa' })
    );
    y += ROW_H;

    this.panelCanvas.addWidget(
      new ColorWheelWidget(PAD_X, y, contentW, COLOR_WHEEL_H, {
        color: [...node.material.color] as [number, number, number],
        onChange: (color) => {
          this.commandBus?.exec({
            cmd: 'set_material',
            id: node.id,
            material: { color },
          });
        },
      })
    );
    y += COLOR_WHEEL_H + 8;

    this.panelCanvas.addWidget(
      new SliderWidget(PAD_X, y, contentW, SLIDER_H, {
        label: 'Roughness',
        min: 0,
        max: 1,
        value: node.material.roughness,
        onChange: (value) => {
          this.commandBus?.exec({
            cmd: 'set_material',
            id: node.id,
            material: { roughness: value },
          });
        },
      })
    );
    y += SLIDER_H;

    return y;
  }

  private buildLightWidgets(node: SceneNode, y: number, contentW: number): number {
    if (!node.lightData) return y;

    const dropdown = new DropdownWidget(PAD_X, y, contentW, DROPDOWN_H, {
      label: 'Type',
      options: ['point', 'directional', 'spot'],
      selectedIndex: ['point', 'directional', 'spot'].indexOf(node.lightData.type),
      onChange: (index) => {
        const types = ['point', 'directional', 'spot'] as const;
        this.commandBus?.exec({
          cmd: 'set_light_param',
          id: node.id,
          lightType: types[index],
        });
      },
    });
    dropdown.onExpandChange = () => {
      this.updateContent();
    };
    this.panelCanvas.addWidget(dropdown);
    y += DROPDOWN_H + 8;

    this.panelCanvas.addWidget(
      new LabelWidget(PAD_X, y, contentW, ROW_H, { text: 'Color', fontSize: 16, color: '#aaaaaa' })
    );
    y += ROW_H;

    this.panelCanvas.addWidget(
      new ColorWheelWidget(PAD_X, y, contentW, COLOR_WHEEL_H, {
        color: [...node.lightData.color] as [number, number, number],
        onChange: (color) => {
          this.commandBus?.exec({
            cmd: 'set_light_param',
            id: node.id,
            color,
          });
        },
      })
    );
    y += COLOR_WHEEL_H + 8;

    this.panelCanvas.addWidget(
      new SliderWidget(PAD_X, y, contentW, SLIDER_H, {
        label: 'Intensity',
        min: 0,
        max: 50,
        value: node.lightData.intensity,
        onChange: (value) => {
          this.commandBus?.exec({
            cmd: 'set_light_param',
            id: node.id,
            intensity: value,
          });
        },
      })
    );
    y += SLIDER_H;

    return y;
  }

  private buildClayWidgets(node: SceneNode, y: number, contentW: number): number {
    const engine = this.clayManager?.getEngine(node.id) ?? null;
    this.panelCanvas.addWidget(
      new LabelWidget(PAD_X, y, contentW, ROW_H, {
        text: engine ? 'Clay node' : 'Clay node (initializing...)',
        color: '#aaaaaa',
      })
    );
    y += ROW_H + 4;

    this.panelCanvas.addWidget(
      new LabelWidget(PAD_X, y, contentW, ROW_H, { text: 'Color Tint', fontSize: 16, color: '#aaaaaa' })
    );
    y += ROW_H;

    this.panelCanvas.addWidget(
      new ColorWheelWidget(PAD_X, y, contentW, COLOR_WHEEL_H, {
        color: [...node.material.color] as [number, number, number],
        onChange: (color) => {
          this.commandBus?.exec({
            cmd: 'set_material',
            id: node.id,
            material: { color },
          });
        },
      })
    );
    y += COLOR_WHEEL_H + 8;

    this.panelCanvas.addWidget(
      new SliderWidget(PAD_X, y, contentW, SLIDER_H, {
        label: 'Roughness',
        min: 0,
        max: 1,
        value: node.material.roughness,
        onChange: (value) => {
          this.commandBus?.exec({
            cmd: 'set_material',
            id: node.id,
            material: { roughness: value },
          });
        },
      })
    );
    y += SLIDER_H;

    return y;
  }

  private buildAnimationPlayerWidgets(node: SceneNode, y: number, contentW: number): number {
    const data = node.animationPlayerData;
    this.panelCanvas.addWidget(
      new LabelWidget(PAD_X, y, contentW, ROW_H, {
        text: `Targets: ${data?.targetIds.length ?? 0}`,
        color: '#aaaaaa',
      })
    );
    y += ROW_H;

    this.panelCanvas.addWidget(
      new LabelWidget(PAD_X, y, contentW, ROW_H, {
        text: `Clips: ${data?.clipIds.length ?? 0}`,
        color: '#aaaaaa',
      })
    );
    y += ROW_H;

    this.panelCanvas.addWidget(
      new LabelWidget(PAD_X, y, contentW, ROW_H * 2, {
        text: 'Animation authoring is not implemented yet.',
        color: '#888888',
      })
    );
    y += ROW_H * 2;

    return y;
  }
}
