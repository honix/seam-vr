import { describe, expect, it, vi } from 'vitest';
import { seedDefaultHarnessScene } from '../../src/test-harness/harness';

describe('seedDefaultHarnessScene', () => {
  it('creates the baseline clay node and clears history afterwards', async () => {
    const engine = {
      seedSphere: vi.fn(async () => {}),
    };
    const commandBus = {
      exec: vi.fn(),
      clearHistory: vi.fn(),
    } as any;
    const clayManager = {
      syncAll: vi.fn(async () => {}),
      setActiveClay: vi.fn(),
      getEngine: vi.fn(() => engine),
    } as any;
    const selectionManager = {
      selectById: vi.fn(),
    } as any;

    await seedDefaultHarnessScene(commandBus, clayManager, selectionManager);

    expect(commandBus.exec).toHaveBeenCalledWith({
      cmd: 'create_clay',
      id: 'clay_1',
      position: [0, 1.2, 0],
    });
    expect(clayManager.syncAll).toHaveBeenCalledTimes(1);
    expect(clayManager.setActiveClay).toHaveBeenCalledWith('clay_1');
    expect(clayManager.getEngine).toHaveBeenCalledWith('clay_1');
    expect(engine.seedSphere).toHaveBeenCalledWith([0.06, 0.06, 0.06], 0.09);
    expect(selectionManager.selectById).toHaveBeenCalledWith('clay_1');
    expect(commandBus.clearHistory).toHaveBeenCalledTimes(1);
  });
});
