import * as THREE from 'three';
import { CommandBus } from '../core/command-bus';
import { SceneGraph } from '../core/scene-graph';
import { TimelineController } from '../animation/timeline-controller';
import { RadialMenu } from './radial-menu';
import { TimelinePanel } from './timeline-panel';
import { InspectorPanel } from './inspector-panel';
import { HierarchyPanel } from './hierarchy-panel';
import { FloatingPanel } from './floating-panel';
import { ToolSystem } from '../interaction/tool-system';
import type { SculptEngine } from '../sculpting/sculpt-engine';
import type { Vec3 } from '../types';

export class UIManager {
  radialMenuL: RadialMenu;
  radialMenuR: RadialMenu;
  timeline: TimelinePanel;
  inspector: InspectorPanel;
  hierarchy: HierarchyPanel;

  private sceneGraph: SceneGraph;

  constructor(
    scene: THREE.Scene,
    commandBus: CommandBus,
    timelineController: TimelineController,
    toolSystem: ToolSystem,
    sceneGraph: SceneGraph,
    worldGroup: THREE.Object3D,
  ) {
    this.sceneGraph = sceneGraph;
    this.radialMenuL = new RadialMenu(scene, toolSystem, 'left');
    this.radialMenuR = new RadialMenu(scene, toolSystem, 'right');
    this.timeline = new TimelinePanel(scene, timelineController);
    this.inspector = new InspectorPanel(worldGroup);
    this.inspector.setCommandBus(commandBus);
    this.hierarchy = new HierarchyPanel(worldGroup, sceneGraph);
  }

  setSculptEngine(engine: SculptEngine): void {
    this.inspector.setSculptEngine(engine);
  }

  /** Get all floating panels for grip-based dragging and ray interaction. */
  getPanels(): FloatingPanel[] {
    return [this.inspector, this.hierarchy];
  }

  toggleInspector(position: Vec3, direction: Vec3): void {
    const openPosition = this.computePanelOpenPosition(position, direction);
    this.inspector.toggle(openPosition, position);
  }

  toggleHierarchy(position: Vec3, direction: Vec3): void {
    const openPosition = this.computePanelOpenPosition(position, direction);
    this.hierarchy.toggle(openPosition, position);
    if (this.hierarchy.isOpen) {
      this.hierarchy.updateContent();
    }
  }

  update(): void {
    this.timeline.update();
    this.updatePanels();
  }

  private updatePanels(): void {
    if (this.inspector.isOpen) {
      this.inspector.updateCanvas();
    }
    if (this.hierarchy.isOpen) {
      this.hierarchy.updateCanvas();
    }
  }

  private computePanelOpenPosition(position: Vec3, direction: Vec3): Vec3 {
    const spawnDistance = 0.28;
    const lift = 0.05;
    return [
      position[0] + direction[0] * spawnDistance,
      position[1] + direction[1] * spawnDistance + lift,
      position[2] + direction[2] * spawnDistance,
    ];
  }
}
