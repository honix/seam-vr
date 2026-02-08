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
        params.radiusTop ?? 0.5,
        params.radiusBottom ?? 0.5,
        params.height ?? 1,
        params.radialSegments ?? 32,
        params.heightSegments ?? 8
      );
    case 'sphere':
      return new THREE.SphereGeometry(
        params.radius ?? 0.5,
        params.widthSegments ?? 32,
        params.heightSegments ?? 16
      );
    case 'box':
      return new THREE.BoxGeometry(
        params.width ?? 1,
        params.height ?? 1,
        params.depth ?? 1,
        params.widthSegments ?? 4,
        params.heightSegments ?? 4,
        params.depthSegments ?? 4
      );
    case 'cone':
      return new THREE.ConeGeometry(
        params.radius ?? 0.5,
        params.height ?? 1,
        params.radialSegments ?? 32,
        params.heightSegments ?? 8
      );
    case 'torus':
      return new THREE.TorusGeometry(
        params.radius ?? 0.5,
        params.tube ?? 0.2,
        params.radialSegments ?? 16,
        params.tubularSegments ?? 48
      );
    case 'capsule':
      return new THREE.CapsuleGeometry(
        params.radius ?? 0.25,
        params.length ?? 0.5,
        params.capSegments ?? 8,
        params.radialSegments ?? 16
      );
    case 'tube': {
      // Tube along a straight line by default; params.points could customize
      const path = new THREE.LineCurve3(
        new THREE.Vector3(0, -(params.length ?? 1) / 2, 0),
        new THREE.Vector3(0, (params.length ?? 1) / 2, 0)
      );
      return new THREE.TubeGeometry(
        path,
        params.tubularSegments ?? 16,
        params.radius ?? 0.15,
        params.radialSegments ?? 12,
        false
      );
    }
    default:
      return new THREE.BoxGeometry(1, 1, 1);
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
  private nodeData: Map<string, NodeRenderData> = new Map();

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
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
    }
  }

  private handleUndo(
    cmd: { cmd: string; [key: string]: any },
    sceneGraph: SceneGraph
  ): void {
    switch (cmd.cmd) {
      case 'spawn':
        // Undo of spawn = removal
        this.onNodeRemoved(cmd.id);
        break;
      case 'delete': {
        // Undo of delete = re-add
        const node = sceneGraph.getNode(cmd.id);
        if (node) this.onNodeAdded(node);
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

    // Add to Three.js scene
    this.scene.add(mesh);

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
   * Called when a node is removed from the scene graph.
   */
  onNodeRemoved(nodeId: string): void {
    const data = this.nodeData.get(nodeId);
    if (!data) return;

    this.scene.remove(data.mesh);
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
