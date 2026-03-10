// Per-hand tool selection system with contextual availability.

import type { Hand, NodeType } from '../types';

export type WindowToolId = 'inspector' | 'hierarchy' | 'timeline';

export type ToolId =
  | 'sculpt_add'
  | 'sculpt_subtract'
  | 'sculpt_smooth'
  | 'spawn_cube'
  | 'spawn_sphere'
  | 'spawn_capsule'
  | 'spawn_light'
  | 'move_layer'
  | 'select'
  | WindowToolId;

export type ToolCategory = 'sculpt' | 'spawn' | 'layer' | 'ui';

export interface ToolDefinition {
  id: ToolId;
  label: string;
  color: number;
  category: ToolCategory;
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  { id: 'sculpt_add',      label: 'Add',        color: 0x44cc44, category: 'sculpt' },
  { id: 'sculpt_subtract', label: 'Subtract',   color: 0xcc4444, category: 'sculpt' },
  { id: 'sculpt_smooth',   label: 'Smooth',     color: 0x9944cc, category: 'sculpt' },
  { id: 'spawn_cube',      label: 'Cube',       color: 0xcccc44, category: 'spawn' },
  { id: 'spawn_sphere',    label: 'Sphere',     color: 0xcccc44, category: 'spawn' },
  { id: 'spawn_capsule',   label: 'Capsule',    color: 0xcccc44, category: 'spawn' },
  { id: 'spawn_light',     label: 'Light',      color: 0xffffaa, category: 'spawn' },
  { id: 'move_layer',      label: 'Move Layer', color: 0x4488ff, category: 'layer' },
  { id: 'select',          label: 'Select',     color: 0xff8800, category: 'layer' },
  { id: 'inspector',       label: 'Inspector',  color: 0xaaaaaa, category: 'ui' },
  { id: 'hierarchy',       label: 'Hierarchy',  color: 0xaaaaaa, category: 'ui' },
  { id: 'timeline',        label: 'Timeline',   color: 0xaaaaaa, category: 'ui' },
];

export function getToolDef(id: ToolId): ToolDefinition {
  return TOOL_REGISTRY.find(t => t.id === id)!;
}

export function isSculptTool(id: ToolId): boolean {
  return id.startsWith('sculpt_');
}

export function isSpawnTool(id: ToolId): boolean {
  return id.startsWith('spawn_');
}

export function isSelectTool(id: ToolId): boolean {
  return id === 'select';
}

export function isWindowTool(id: ToolId): id is WindowToolId {
  return id === 'inspector' || id === 'hierarchy' || id === 'timeline';
}

export type ToolChangeCallback = (hand: Hand, tool: ToolId) => void;

export class ToolSystem {
  leftTool: ToolId = 'select';
  rightTool: ToolId = 'select';
  onToolChange: ToolChangeCallback | null = null;

  leftBrushRadius = 0.02;
  rightBrushRadius = 0.02;

  private selectedNodeType: NodeType | null = null;

  setTool(hand: Hand, tool: ToolId): void {
    const nextTool = this.isToolAvailable(tool) ? tool : 'select';
    if (hand === 'left') {
      if (this.leftTool === nextTool) return;
      this.leftTool = nextTool;
    } else {
      if (this.rightTool === nextTool) return;
      this.rightTool = nextTool;
    }
    this.onToolChange?.(hand, nextTool);
  }

  getTool(hand: Hand): ToolId {
    return hand === 'left' ? this.leftTool : this.rightTool;
  }

  getBrushRadius(hand: Hand): number {
    return hand === 'left' ? this.leftBrushRadius : this.rightBrushRadius;
  }

  adjustBrushRadius(hand: Hand, delta: number): void {
    if (hand === 'left') {
      this.leftBrushRadius = Math.max(0.001, this.leftBrushRadius + delta);
    } else {
      this.rightBrushRadius = Math.max(0.001, this.rightBrushRadius + delta);
    }
  }

  setSelectedNodeType(nodeType: NodeType | null): void {
    this.selectedNodeType = nodeType;
    if (!this.canUseSculptTools()) {
      if (isSculptTool(this.leftTool)) {
        this.setTool('left', 'select');
      }
      if (isSculptTool(this.rightTool)) {
        this.setTool('right', 'select');
      }
    }
  }

  canUseSculptTools(): boolean {
    return this.selectedNodeType === 'clay';
  }

  isToolAvailable(tool: ToolId): boolean {
    if (isSculptTool(tool)) {
      return this.canUseSculptTools();
    }
    return true;
  }

  getAvailableTools(): ToolDefinition[] {
    return TOOL_REGISTRY.filter((tool) => this.isToolAvailable(tool.id));
  }
}
