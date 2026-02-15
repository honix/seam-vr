// Per-hand tool selection system.
// Replaces ModeManager with independent tool state per hand.

export type ToolId =
  | 'sculpt_add'
  | 'sculpt_subtract'
  | 'sculpt_smooth'
  | 'sculpt_move'
  | 'spawn_cube'
  | 'spawn_sphere'
  | 'spawn_capsule'
  | 'spawn_light'
  | 'move_layer'
  | 'select'
  | 'inspector'
  | 'hierarchy';

export type ToolCategory = 'sculpt' | 'spawn' | 'layer' | 'ui';

export interface ToolDefinition {
  id: ToolId;
  label: string;
  color: number;
  category: ToolCategory;
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  { id: 'sculpt_add',       label: 'Add',        color: 0x44cc44, category: 'sculpt' },
  { id: 'sculpt_subtract',  label: 'Subtract',   color: 0xcc4444, category: 'sculpt' },
  { id: 'sculpt_smooth',    label: 'Smooth',     color: 0x9944cc, category: 'sculpt' },
  { id: 'sculpt_move',      label: 'Move',       color: 0x44cccc, category: 'sculpt' },
  { id: 'spawn_cube',       label: 'Cube',       color: 0xcccc44, category: 'spawn' },
  { id: 'spawn_sphere',     label: 'Sphere',     color: 0xcccc44, category: 'spawn' },
  { id: 'spawn_capsule',    label: 'Capsule',    color: 0xcccc44, category: 'spawn' },
  { id: 'spawn_light',      label: 'Light',      color: 0xffffaa, category: 'spawn' },
  { id: 'move_layer',       label: 'Move Layer', color: 0x4488ff, category: 'layer' },
  { id: 'select',           label: 'Select',     color: 0xff8800, category: 'layer' },
  { id: 'inspector',        label: 'Inspector',  color: 0xaaaaaa, category: 'ui' },
  { id: 'hierarchy',        label: 'Hierarchy',  color: 0xaaaaaa, category: 'ui' },
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

export type ToolChangeCallback = (hand: 'left' | 'right', tool: ToolId) => void;

export class ToolSystem {
  leftTool: ToolId = 'sculpt_add';
  rightTool: ToolId = 'sculpt_add';
  onToolChange: ToolChangeCallback | null = null;

  // Per-hand brush radius
  leftBrushRadius: number = 0.02;
  rightBrushRadius: number = 0.02;

  setTool(hand: 'left' | 'right', tool: ToolId): void {
    if (hand === 'left') {
      if (this.leftTool === tool) return;
      this.leftTool = tool;
    } else {
      if (this.rightTool === tool) return;
      this.rightTool = tool;
    }
    this.onToolChange?.(hand, tool);
  }

  getTool(hand: 'left' | 'right'): ToolId {
    return hand === 'left' ? this.leftTool : this.rightTool;
  }

  getBrushRadius(hand: 'left' | 'right'): number {
    return hand === 'left' ? this.leftBrushRadius : this.rightBrushRadius;
  }

  adjustBrushRadius(hand: 'left' | 'right', delta: number): void {
    if (hand === 'left') {
      this.leftBrushRadius = Math.max(0.001, this.leftBrushRadius + delta);
    } else {
      this.rightBrushRadius = Math.max(0.001, this.rightBrushRadius + delta);
    }
  }
}
