import * as THREE from 'three';
import type { CommandBus } from '../core/command-bus';
import type { SceneGraph, SceneNode } from '../core/scene-graph';
import type { PrimitiveType } from '../types';
import { createMaterial, updateMaterial } from './material';
import { DeformerStack } from '../deformers/deformer-stack';
import type { DeformerParams } from '../deformers/deformer-types';

/**
 * Generate a Three.js BufferGeometry from a primitive type and parameters.
 */
function createGeometry(
  type: PrimitiveType,
  params: Record<string, number>
): THREE.BufferGeometry {
  switch (type) {
    case 'cylinder':
      return new THREE.CylinderGeometry(
        params.radiusTop ?? 0.05,
        params.radiusBottom ?? 0.05,
        params.height ?? 0.1,
        params.radialSegments ?? 16,
        params.heightSegments ?? 12
      );
    case 'sphere':
      return new THREE.SphereGeometry(
        params.radius ?? 0.05,
        params.widthSegments ?? 24,
        params.heightSegments ?? 16
      );
    case 'box':
      return new THREE.BoxGeometry(
        params.width ?? 0.1,
        params.height ?? 0.1,
        params.depth ?? 0.1,
        params.widthSegments ?? 4,
        params.heightSegments ?? 4,
        params.depthSegments ?? 4
      );
    case 'cone':
      return new THREE.ConeGeometry(
        params.radius ?? 0.05,
        params.height ?? 0.1,
        params.radialSegments ?? 16,
        params.heightSegments ?? 12
      );
    case 'torus':
      return new THREE.TorusGeometry(
        params.radius ?? 0.05,
        params.tube ?? 0.015,
        params.radialSegments ?? 16,
        params.tubularSegments ?? 32
      );
    case 'capsule':
      return new THREE.CapsuleGeometry(
        params.radius ?? 0.03,
        params.length ?? 0.1,
        params.capSegments ?? 8,
        params.radialSegments ?? 16
      );
    case 'tube': {
      const path = new THREE.LineCurve3(
        new THREE.Vector3(0, -(params.length ?? 0.1) / 2, 0),
        new THREE.Vector3(0, (params.length ?? 0.1) / 2, 0)
      );
      return new THREE.TubeGeometry(
        path,
        params.tubularSegments ?? 32,
        params.radius ?? 0.01,
        params.radialSegments ?? 8,
        false
      );
    }
    default:
      return new THREE.BoxGeometry(0.1, 0.1, 0.1);
  }
}

// Track per-node data that the pipeline manages
interface NodeRenderData {
  mesh: THREE.Mesh;
  sourceGeometry: THREE.BufferGeometry;
  deformerStack: DeformerStack;
}

/**
 * Central rendering orchestrator.
 * Keeps Three.js scene in sync with the SceneGraph via command bus events.
 */
export class RenderPipeline {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private contentParent: THREE.Object3D;
  private nodeData: Map<string, NodeRenderData> = new Map();

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.contentParent = scene; // Default: add meshes directly to scene
  }

  /**
   * Set the parent group for spawned content meshes.
   * Used by world navigation to parent content into a movable group.
   */
  setContentParent(parent: THREE.Object3D): void {
    this.contentParent = parent;
  }

  /**
   * Subscribe to command bus events to keep Three.js scene in sync.
   */
  connectCommandBus(bus: CommandBus, sceneGraph: SceneGraph): void {
    bus.on('command:executed', ({ cmd }) => {
      this.handleCommand(cmd, sceneGraph);
    });

    bus.on('command:undone', ({ cmd }) => {
      // On undo, the scene graph has already been reverted.
      // We need to refresh the affected node.
      this.handleUndo(cmd, sceneGraph);
    });
  }

  private handleCommand(
    cmd: { cmd: string; [key: string]: any },
    sceneGraph: SceneGraph
  ): void {
    switch (cmd.cmd) {
      case 'spawn': {
        const node = sceneGraph.getNode(cmd.id);
        if (node) this.onNodeAdded(node);
        break;
      }
      case 'delete': {
        this.onNodeRemoved(cmd.id);
        break;
      }
      case 'set_param': {
        const node = sceneGraph.getNode(cmd.id);
        if (node) this.onNodeUpdated(node, 'params');
        break;
      }
      case 'set_transform': {
        const node = sceneGraph.getNode(cmd.id);
        if (node) this.onNodeUpdated(node, 'transform');
        break;
      }
      case 'add_deformer':
      case 'remove_deformer': {
        const node = sceneGraph.getNode(cmd.target ?? cmd.id);
        if (node) this.onNodeUpdated(node, 'deformers');
        break;
      }
      case 'set_material': {
        const node = sceneGraph.getNode(cmd.id);
        if (node) this.onNodeUpdated(node, 'material');
        break;
      }
      case 'spawn_light': {
        const node = sceneGraph.getNode(cmd.id);
        if (node) this.onLightAdded(node, cmd);
        break;
      }
      case 'set_visibility': {
        const data = this.nodeData.get(cmd.id);
        if (data) {
          data.mesh.visible = cmd.visible;
        }
        break;
      }
      case 'set_light_param': {
        const data = this.nodeData.get(cmd.id);
        if (data) {
          const light = data.mesh.children.find(c => c instanceof THREE.PointLight) as THREE.PointLight | undefined;
          if (light) {
            if (cmd.intensity !== undefined) light.intensity = cmd.intensity;
            if (cmd.color) light.color.setRGB(cmd.color[0], cmd.color[1], cmd.color[2]);
          }
        }
        break;
      }
      case 'create_group':
        // Groups have no mesh representation
        break;
    }
  }

  private handleUndo(
    cmd: { cmd: string; [key: string]: any },
    sceneGraph: SceneGraph
  ): void {
    switch (cmd.cmd) {
      case 'spawn':
      case 'spawn_light':
        // Undo of spawn = removal
        this.onNodeRemoved(cmd.id);
        break;
      case 'delete': {
        // Undo of delete = re-add
        const node = sceneGraph.getNode(cmd.id);
        if (node) this.onNodeAdded(node);
        break;
      }
      case 'set_visibility': {
        const data = this.nodeData.get(cmd.id);
        const node = sceneGraph.getNode(cmd.id);
        if (data && node) {
          data.mesh.visible = node.visible;
        }
        break;
      }
      default: {
        // For parameter/transform/deformer/material changes, refresh the node
        const node = sceneGraph.getNode(cmd.id);
        if (node) this.onNodeUpdated(node, 'full');
        break;
      }
    }
  }

  /**
   * Called when a new node is added to the scene graph.
   */
  onNodeAdded(node: SceneNode): void {
    // Generate geometry
    const sourceGeometry = createGeometry(node.type, node.params);

    // Create deformer stack from node's deformers
    const deformerStack = new DeformerStack();
    for (const defConfig of node.deformers) {
      deformerStack.add(defConfig as DeformerParams);
    }

    // Apply deformations
    const deformedGeometry = deformerStack.apply(sourceGeometry);

    // Create material
    const material = createMaterial(node.material);

    // Create mesh
    const mesh = new THREE.Mesh(deformedGeometry, material);
    mesh.name = `node_${node.id}`;

    // Apply transform
    this.applyTransform(mesh, node);

    // Add to content parent (worldGroup or scene)
    this.contentParent.add(mesh);

    // Store reference on node for other systems
    node.mesh = mesh;

    // Track render data
    this.nodeData.set(node.id, {
      mesh,
      sourceGeometry,
      deformerStack,
    });
  }

  /**
   * Called when a light node is spawned.
   * Creates a PointLight + small glowing sphere visual.
   */
  private onLightAdded(node: SceneNode, cmd: { [key: string]: any }): void {
    const intensity = cmd.intensity ?? 1.0;
    const colorArr = cmd.color ?? [1, 1, 0.9];
    const threeColor = new THREE.Color(colorArr[0], colorArr[1], colorArr[2]);

    // Visual mesh: small glowing sphere
    const geo = new THREE.SphereGeometry(0.03, 12, 8);
    const mat = new THREE.MeshBasicMaterial({ color: threeColor });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `light_${node.id}`;

    // Attach actual PointLight as child
    const light = new THREE.PointLight(threeColor, intensity, 10);
    mesh.add(light);

    // Position
    if (cmd.position) {
      mesh.position.set(cmd.position[0], cmd.position[1], cmd.position[2]);
    }

    this.contentParent.add(mesh);
    node.mesh = mesh;

    this.nodeData.set(node.id, {
      mesh,
      sourceGeometry: geo,
      deformerStack: new DeformerStack(),
    });
  }

  /**
   * Called when a node is removed from the scene graph.
   */
  onNodeRemoved(nodeId: string): void {
    const data = this.nodeData.get(nodeId);
    if (!data) return;

    this.contentParent.remove(data.mesh);
    data.mesh.geometry.dispose();
    (data.mesh.material as THREE.Material).dispose();
    data.sourceGeometry.dispose();

    this.nodeData.delete(nodeId);
  }

  /**
   * Called when node parameters, transform, deformers, or material change.
   */
  onNodeUpdated(node: SceneNode, changeType: string): void {
    const data = this.nodeData.get(node.id);
    if (!data) return;

    switch (changeType) {
      case 'params':
      case 'full': {
        // Regenerate geometry from scratch
        data.sourceGeometry.dispose();
        data.mesh.geometry.dispose();
        const newSource = createGeometry(node.type, node.params);
        data.sourceGeometry = newSource;

        // Rebuild deformer stack
        data.deformerStack.deformers = node.deformers.map(d => d as DeformerParams);
        data.mesh.geometry = data.deformerStack.apply(newSource);

        // Also refresh material and transform on full update
        if (changeType === 'full') {
          updateMaterial(
            data.mesh.material as THREE.MeshStandardMaterial,
            node.material
          );
          this.applyTransform(data.mesh, node);
        }
        break;
      }
      case 'transform':
        this.applyTransform(data.mesh, node);
        break;
      case 'deformers':
        this.applyDeformers(node);
        break;
      case 'material':
        updateMaterial(
          data.mesh.material as THREE.MeshStandardMaterial,
          node.material
        );
        break;
    }
  }

  /**
   * Apply the deformer stack to a node's geometry.
   */
  applyDeformers(node: SceneNode): void {
    const data = this.nodeData.get(node.id);
    if (!data) return;

    // Rebuild deformer stack from node config
    data.deformerStack.deformers = node.deformers.map(d => d as DeformerParams);

    // Dispose old deformed geometry
    data.mesh.geometry.dispose();

    // Apply deformations to source geometry
    data.mesh.geometry = data.deformerStack.apply(data.sourceGeometry);
  }

  /**
   * Apply node transform to Three.js mesh.
   */
  private applyTransform(mesh: THREE.Mesh, node: SceneNode): void {
    const { position, rotation, scale } = node.transform;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
  }

  /**
   * Render a single frame.
   */
  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
