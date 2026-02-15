// Inspector panel - shows and edits properties of the selected layer.
// Content rendered via Canvas 2D widgets on PanelCanvas.

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
import type { SculptEngine } from '../sculpting/sculpt-engine';

// Padding and widget heights in canvas pixels.
// Actual pixel counts are derived from mesh size at 2048 PPM, but we use
// proportional values so layout works at any panel size.
const PAD_X = 10;
const ROW_H = 28;
const SLIDER_H = 52;
const COLOR_WHEEL_H = 150;
const DROPDOWN_H = 30;

export class InspectorPanel extends FloatingPanel {
  private selectedNode: SceneNode | null = null;
  private commandBus: CommandBus | null = null;
  private sculptEngine: SculptEngine | null = null;

  constructor(parent: THREE.Object3D) {
    super(parent, 'Inspector', 0.25, 0.45);
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
    this.panelCanvas.clearWidgets();
    const cw = this.panelCanvas.canvasWidth;
    const contentW = cw - PAD_X * 2;

    if (!this.selectedNode) {
      this.panelCanvas.addWidget(
        new LabelWidget(PAD_X, 10, contentW, ROW_H, { text: 'No layer selected', color: '#888888' })
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

    if (node.layerType === 'primitive') {
      y = this.buildPrimitiveWidgets(node, y, contentW);
    } else if (node.layerType === 'light') {
      y = this.buildLightWidgets(node, y, contentW);
    } else if (node.nodeType === 'sculpt_volume') {
      y = this.buildSculptWidgets(y, contentW);
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
      this.relayoutFromDropdown();
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

  private buildSculptWidgets(y: number, contentW: number): number {
    if (!this.sculptEngine) return y;

    const mat = this.sculptEngine.sculptMaterial;

    this.panelCanvas.addWidget(
      new LabelWidget(PAD_X, y, contentW, ROW_H, { text: 'Color Tint', fontSize: 16, color: '#aaaaaa' })
    );
    y += ROW_H;

    this.panelCanvas.addWidget(
      new ColorWheelWidget(PAD_X, y, contentW, COLOR_WHEEL_H, {
        color: [mat.color.r, mat.color.g, mat.color.b],
        onChange: (color) => {
          if (this.sculptEngine) {
            this.sculptEngine.sculptMaterial.color.setRGB(color[0], color[1], color[2]);
          }
        },
      })
    );
    y += COLOR_WHEEL_H + 8;

    this.panelCanvas.addWidget(
      new SliderWidget(PAD_X, y, contentW, SLIDER_H, {
        label: 'Roughness',
        min: 0,
        max: 1,
        value: mat.roughness,
        onChange: (value) => {
          if (this.sculptEngine) {
            this.sculptEngine.sculptMaterial.roughness = value;
          }
        },
      })
    );
    y += SLIDER_H;

    return y;
  }

  private relayoutFromDropdown(): void {
    this.updateContent();
  }

  override dispose(): void {
    super.dispose();
  }
}
