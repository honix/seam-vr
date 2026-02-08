import * as THREE from 'three';
import { CommandBus } from '../core/command-bus';
import { TimelineController } from '../animation/timeline-controller';
import { RadialPalette } from './radial-palette';
import { TimelinePanel } from './timeline-panel';

export class UIManager {
  palette: RadialPalette;
  timeline: TimelinePanel;

  constructor(
    scene: THREE.Scene,
    commandBus: CommandBus,
    timelineController: TimelineController
  ) {
    this.palette = new RadialPalette(scene, commandBus);
    this.timeline = new TimelinePanel(scene, timelineController);
  }

  update(): void {
    this.timeline.update();
  }
}
