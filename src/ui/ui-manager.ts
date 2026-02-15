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

  toggleInspector(position: Vec3): void {
    this.inspector.toggle(position);
  }

  toggleHierarchy(position: Vec3): void {
    this.hierarchy.toggle(position);
    if (this.hierarchy.isOpen) {
      this.hierarchy.updateContent();
    }
  }

  update(): void {
    this.timeline.update();
  }
}
