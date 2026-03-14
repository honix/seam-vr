import { describe, expect, it } from 'vitest';
import { normalizeHierarchyParentId } from '../../src/ui/ui-manager';

describe('normalizeHierarchyParentId', () => {
  it('maps synthetic root selection to a top-level parent id', () => {
    expect(normalizeHierarchyParentId('__root__')).toBeNull();
  });

  it('preserves concrete selected node ids', () => {
    expect(normalizeHierarchyParentId('group_1')).toBe('group_1');
  });
});
