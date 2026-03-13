import * as THREE from 'three';
import { FloatingPanel } from './floating-panel';
import { TimelineController } from '../animation/timeline-controller';
import { ButtonWidget, LabelWidget, SliderWidget } from './widgets';
import { SceneNode } from '../core/scene-graph';

const PAD_X = 10;
const ROW_H = 28;
const BUTTON_H = 28;
const BUTTON_W = 84;
const BUTTON_GAP = 8;
const SLIDER_H = 52;

export class TimelinePanel extends FloatingPanel {
  readonly panelKind = 'timeline';

  private timelineController: TimelineController;
  private selectedNode: SceneNode | null = null;

  constructor(parent: THREE.Object3D, timelineController: TimelineController) {
    super(parent, 'Timeline', 0.36, 0.24);
    this.timelineController = timelineController;
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
    let y = 10;

    this.panelCanvas.addWidget(
      new LabelWidget(PAD_X, y, contentW, ROW_H, {
        text: `Target: ${this.selectedNode?.id ?? 'None'}`,
      })
    );
    y += ROW_H;

    this.panelCanvas.addWidget(
      new LabelWidget(PAD_X, y, contentW, ROW_H, {
        text: `State: ${this.timelineController.state}`,
        color: '#aaaaaa',
      })
    );
    y += ROW_H + 4;

    this.panelCanvas.addWidget(
      new ButtonWidget(PAD_X, y, BUTTON_W, BUTTON_H, {
        text: this.timelineController.state === 'playing' ? 'Pause' : 'Play',
        onClick: () => {
          if (this.timelineController.state === 'playing') {
            this.timelineController.pause();
          } else {
            this.timelineController.play();
          }
          this.updateContent();
        },
      })
    );

    this.panelCanvas.addWidget(
      new ButtonWidget(PAD_X + BUTTON_W + BUTTON_GAP, y, BUTTON_W, BUTTON_H, {
        text: 'Stop',
        onClick: () => {
          this.timelineController.stop();
          this.updateContent();
        },
      })
    );

    y += BUTTON_H + 8;

    this.panelCanvas.addWidget(
      new SliderWidget(PAD_X, y, contentW, SLIDER_H, {
        label: 'Time',
        min: 0,
        max: Math.max(0.001, this.timelineController.duration),
        value: this.timelineController.currentTime,
        onChange: (value) => {
          this.timelineController.seek(value);
          this.updateContent();
        },
      })
    );
    y += SLIDER_H;

    this.panelCanvas.addWidget(
      new LabelWidget(PAD_X, y, contentW, ROW_H, {
        text: 'Track editing is not implemented yet.',
        color: '#888888',
      })
    );

    this.panelCanvas.markDirty();
  }
}
