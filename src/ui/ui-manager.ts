import * as THREE from 'three';
import { CommandBus } from '../core/command-bus';
import { SceneGraph, SceneNode } from '../core/scene-graph';
import { TimelineController } from '../animation/timeline-controller';
import { RadialMenu } from './radial-menu';
import { TimelinePanel } from './timeline-panel';
import { InspectorPanel } from './inspector-panel';
import { HierarchyPanel } from './hierarchy-panel';
import { FloatingPanel } from './floating-panel';
import { ToolSystem, isWindowTool, ToolId, WindowToolId } from '../interaction/tool-system';
import { WindowToolController } from './window-tool-controller';
import type { ClayManager } from '../sculpting/clay-manager';
import type { Hand, Vec3, Vec4 } from '../types';
import type { XRControllerState } from '../xr/xr-controller';

type ManagedPanel = InspectorPanel | HierarchyPanel | TimelinePanel;

interface HandAnchorPose {
  position: Vec3;
  quaternion: Vec4;
}

function isInspectorPanel(panel: FloatingPanel): panel is InspectorPanel {
  return panel instanceof InspectorPanel;
}

function isHierarchyPanel(panel: FloatingPanel): panel is HierarchyPanel {
  return panel instanceof HierarchyPanel;
}

function isTimelinePanel(panel: FloatingPanel): panel is TimelinePanel {
  return panel instanceof TimelinePanel;
}

export class UIManager {
  radialMenuL: RadialMenu;
  radialMenuR: RadialMenu;

  private commandBus: CommandBus;
  private timelineController: TimelineController;
  private toolSystem: ToolSystem;
  private sceneGraph: SceneGraph;
  private worldGroup: THREE.Object3D;
  private scene: THREE.Scene;
  private camera: THREE.Camera | null = null;
  private clayManager: ClayManager | null = null;
  private windowController = new WindowToolController();
  private livePanels: Record<Hand, ManagedPanel | null> = { left: null, right: null };
  private detachedPanels: ManagedPanel[] = [];
  private selectedNode: SceneNode | null = null;
  private selectedNodeId: string | null = null;
  private lastHandAnchor: Record<Hand, HandAnchorPose | null> = { left: null, right: null };
  private hierarchySelectCallback: ((nodeId: string) => void) | null = null;

  constructor(
    scene: THREE.Scene,
    commandBus: CommandBus,
    timelineController: TimelineController,
    toolSystem: ToolSystem,
    sceneGraph: SceneGraph,
    worldGroup: THREE.Object3D,
  ) {
    this.scene = scene;
    this.commandBus = commandBus;
    this.timelineController = timelineController;
    this.toolSystem = toolSystem;
    this.sceneGraph = sceneGraph;
    this.worldGroup = worldGroup;
    this.radialMenuL = new RadialMenu(scene, toolSystem, 'left');
    this.radialMenuR = new RadialMenu(scene, toolSystem, 'right');

    this.sceneGraph.on('node:removed', ({ node }) => {
      this.handleNodeRemoved(node);
    });
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  setClayManager(manager: ClayManager): void {
    this.clayManager = manager;
  }

  onHierarchySelect(callback: (nodeId: string) => void): void {
    this.hierarchySelectCallback = callback;
  }

  setSelection(nodeId: string | null, node: SceneNode | null): void {
    this.selectedNodeId = nodeId;
    this.selectedNode = node;
    this.toolSystem.setSelectedNodeType(node?.nodeType ?? null);
    this.clayManager?.setActiveClay(node?.nodeType === 'clay' ? node.id : null);

    for (const panel of this.getPanels()) {
      if (isHierarchyPanel(panel)) {
        panel.setSelectedNodeId(nodeId);
      }
      if (panel.hostMode === 'hand') {
        this.applySelectionToPanel(panel, node);
      }
    }
  }

  handleToolChange(hand: Hand, tool: ToolId): void {
    const transition = this.windowController.applyTool(hand, tool);
    switch (transition.kind) {
      case 'noop':
        return;
      case 'close':
        this.closeLivePanel(hand);
        return;
      case 'open':
      case 'replace':
        this.openLivePanel(hand, transition.next);
        return;
    }
  }

  updateHandAnchors(left: XRControllerState, right: XRControllerState): void {
    this.lastHandAnchor.left = this.computeHandAnchor('left', left);
    this.lastHandAnchor.right = this.computeHandAnchor('right', right);

    for (const hand of ['left', 'right'] as const) {
      const panel = this.livePanels[hand];
      const anchor = this.lastHandAnchor[hand];
      if (!panel || !panel.isOpen || !anchor) continue;
      panel.setWorldPose(anchor.position, anchor.quaternion);
    }
  }

  update(): void {
    for (const panel of this.getPanels()) {
      if (!panel.isOpen) continue;
      if (isTimelinePanel(panel)) {
        panel.updateContent();
      }
      panel.updateTargetLine();
      panel.updateCanvas();
    }
    this.detachedPanels = this.detachedPanels.filter((panel) => panel.isOpen);
  }

  dispose(): void {
    for (const hand of ['left', 'right'] as const) {
      this.closeLivePanel(hand);
    }

    for (const panel of this.detachedPanels) {
      panel.close();
      panel.dispose();
    }
    this.detachedPanels = [];

    this.radialMenuL.dispose();
    this.radialMenuR.dispose();
  }

  getPanels(): ManagedPanel[] {
    return [
      ...Object.values(this.livePanels).filter((panel): panel is ManagedPanel => panel !== null),
      ...this.detachedPanels,
    ];
  }

  detachPanel(panel: FloatingPanel): ManagedPanel | null {
    if (panel.hostMode !== 'hand') return null;
    const kind = this.getPanelKind(panel);
    if (!kind) return null;

    const detached = this.createPanel(kind);
    detached.setHostMode('world');
    detached.setOwnerHand(null);

    if (isHierarchyPanel(detached)) {
      detached.setSelectedNodeId(this.selectedNodeId);
    } else if (isInspectorPanel(detached)) {
      detached.setSelectedNode(this.selectedNode);
    } else if (isTimelinePanel(detached)) {
      detached.setSelectedNode(this.selectedNode);
    }

    const targetObject = this.getNodeTargetObject(this.selectedNode);
    if (isInspectorPanel(detached) || isTimelinePanel(detached)) {
      detached.setTargetObject(targetObject, true);
    } else {
      detached.setTargetObject(null, false);
    }

    detached.openAtWorldPose(panel.getWorldPosition(), panel.getWorldQuaternion());
    this.detachedPanels.push(detached);
    return detached;
  }

  createNodeFromHierarchy(kind: string): void {
    const idBase = `${kind}_${Date.now()}`;
    const position = this.computeSpawnPositionInFrontOfCamera();
    const parentId = this.selectedNodeId ?? null;

    switch (kind) {
      case 'group':
        this.commandBus.exec({ cmd: 'create_group', id: idBase, position, parentId });
        break;
      case 'animation_player':
        this.commandBus.exec({ cmd: 'create_animation_player', id: idBase, position, parentId });
        break;
      case 'clay':
        this.commandBus.exec({ cmd: 'create_clay', id: idBase, position, parentId });
        break;
      case 'cube':
        this.commandBus.exec({ cmd: 'spawn', id: `box_${Date.now()}`, type: 'box', position, parentId });
        break;
      case 'sphere':
        this.commandBus.exec({ cmd: 'spawn', id: idBase, type: 'sphere', position, parentId });
        break;
      case 'capsule':
        this.commandBus.exec({ cmd: 'spawn', id: idBase, type: 'capsule', position, parentId });
        break;
      case 'light':
        this.commandBus.exec({ cmd: 'spawn_light', id: `light_${Date.now()}`, position, parentId });
        break;
    }
  }

  private closeLivePanel(hand: Hand): void {
    const panel = this.livePanels[hand];
    if (!panel) return;
    panel.close();
    panel.dispose();
    this.livePanels[hand] = null;
  }

  private openLivePanel(hand: Hand, kind: WindowToolId): void {
    this.closeLivePanel(hand);
    const panel = this.createPanel(kind);
    panel.setHostMode('hand');
    panel.setOwnerHand(hand);
    this.applySelectionToPanel(panel, this.selectedNode);

    const anchor = this.lastHandAnchor[hand];
    if (anchor) {
      panel.openAtWorldPose(anchor.position, anchor.quaternion);
    } else {
      panel.open([hand === 'left' ? -0.2 : 0.2, 1.4, -0.5], [0, 1.6, 0]);
    }

    this.livePanels[hand] = panel;
  }

  private createPanel(kind: WindowToolId): ManagedPanel {
    switch (kind) {
      case 'inspector': {
        const panel = new InspectorPanel(this.scene);
        panel.setCommandBus(this.commandBus);
        if (this.clayManager) {
          panel.setClayManager(this.clayManager);
        }
        return panel;
      }
      case 'hierarchy': {
        const panel = new HierarchyPanel(this.scene, this.sceneGraph);
        panel.onSelect((nodeId) => {
          this.hierarchySelectCallback?.(nodeId);
        });
        panel.onCreate((createKind) => {
          this.createNodeFromHierarchy(createKind);
        });
        return panel;
      }
      case 'timeline': {
        return new TimelinePanel(this.scene, this.timelineController);
      }
    }
  }

  private applySelectionToPanel(panel: ManagedPanel, node: SceneNode | null): void {
    if (isHierarchyPanel(panel)) {
      panel.setSelectedNodeId(this.selectedNodeId);
      panel.setTargetObject(null, false);
      return;
    }

    if (isInspectorPanel(panel) || isTimelinePanel(panel)) {
      panel.setSelectedNode(node);
      panel.setTargetObject(this.getNodeTargetObject(node), true);
    }
  }

  private getNodeTargetObject(node: SceneNode | null): THREE.Object3D | null {
    return node?.object3D ?? node?.mesh ?? null;
  }

  private getPanelKind(panel: FloatingPanel): WindowToolId | null {
    if (isInspectorPanel(panel)) return 'inspector';
    if (isHierarchyPanel(panel)) return 'hierarchy';
    if (isTimelinePanel(panel)) return 'timeline';
    return null;
  }

  private computeHandAnchor(hand: Hand, state: XRControllerState): HandAnchorPose | null {
    if (!this.camera) return null;

    const position = new THREE.Vector3(...state.position);
    const rotation = new THREE.Quaternion(...state.rotation);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation).normalize();

    const anchorPos = position
      .clone()
      .add(forward.multiplyScalar(0.28))
      .add(up.multiplyScalar(0.05))
      .add(right.multiplyScalar(hand === 'left' ? -0.04 : 0.04));

    const facing = new THREE.Object3D();
    facing.position.copy(anchorPos);
    const cameraPos = new THREE.Vector3();
    this.camera.getWorldPosition(cameraPos);
    facing.lookAt(cameraPos);

    return {
      position: [anchorPos.x, anchorPos.y, anchorPos.z],
      quaternion: [facing.quaternion.x, facing.quaternion.y, facing.quaternion.z, facing.quaternion.w],
    };
  }

  private computeSpawnPositionInFrontOfCamera(): Vec3 {
    if (!this.camera) return [0, 1, -0.4];

    const cameraPos = new THREE.Vector3();
    const cameraDir = new THREE.Vector3();
    this.camera.getWorldPosition(cameraPos);
    this.camera.getWorldDirection(cameraDir);
    const worldPos = cameraPos.clone().add(cameraDir.multiplyScalar(0.6));
    const localPos = this.worldGroup.worldToLocal(worldPos);
    return [localPos.x, localPos.y, localPos.z];
  }

  private handleNodeRemoved(node: SceneNode): void {
    for (const panel of this.getPanels()) {
      if ((isInspectorPanel(panel) || isTimelinePanel(panel)) && panel.getSelectedNode()?.id === node.id) {
        panel.setSelectedNode(null);
        panel.setTargetObject(null, false);
      }
    }
  }
}
