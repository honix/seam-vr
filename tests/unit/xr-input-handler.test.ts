import { describe, expect, it } from 'vitest';
import { XREmulator } from '../../src/xr/xr-emulator';
import { XRInputHandler } from '../../src/xr/xr-input-handler';

describe('XR emulator input edges', () => {
  it('emits trigger start, hold, and end on successive frames', () => {
    const emulator = new XREmulator();
    const input = new XRInputHandler(emulator);

    emulator.handleCommand({
      cmd: 'xr_pose',
      hand: 'right',
      position: [0, 1.2, 0],
      rotation: [0, 0, 0, 1],
    });

    emulator.handleCommand({
      cmd: 'xr_button',
      hand: 'right',
      button: 'trigger',
      pressed: true,
    });
    emulator.update();
    const startActions = input.update();
    expect(startActions.map((action) => action.action)).toContain('trigger_start');

    emulator.update();
    const holdActions = input.update();
    expect(holdActions.map((action) => action.action)).toContain('trigger_update');

    emulator.handleCommand({
      cmd: 'xr_button',
      hand: 'right',
      button: 'trigger',
      pressed: false,
    });
    emulator.update();
    const endActions = input.update();
    expect(endActions.map((action) => action.action)).toContain('trigger_end');
  });
});
