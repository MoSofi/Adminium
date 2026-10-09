// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { DOCK_HYSTERESIS, DOCK_WIDTH, PAGE_MIN_WIDTH, SHEET_BELOW, dockLayout } from './dockLayout.js';

const EDGE = PAGE_MIN_WIDTH + DOCK_WIDTH;

describe('how the panel stands beside the page', () => {
  it('is docked while the page keeps its width, as the comp draws 1440 with the rail open', () => {
    // 1440 wide, a 256 px rail: the page and the panel share 1184.
    expect(dockLayout({ viewport: 1440, room: 1184 })).toBe('docked');
  });

  it('lies over the page when the page would be left too narrow, as the comp draws 1024', () => {
    expect(dockLayout({ viewport: 1024, room: 768 })).toBe('over');
  });

  it('follows the room, not the window: a collapsed rail keeps it docked on a narrower window', () => {
    expect(dockLayout({ viewport: 1180, room: 1180 - 64 })).toBe('docked');
    expect(dockLayout({ viewport: 1180, room: 1180 - 256 })).toBe('over');
  });

  it('is a sheet on a phone, whatever the room', () => {
    expect(dockLayout({ viewport: SHEET_BELOW - 1, room: 2_000 })).toBe('sheet');
    expect(dockLayout({ viewport: 390, room: 390, previous: 'docked' })).toBe('sheet');
  });

  it('does not flip on every pixel at the edge', () => {
    // Docked stays docked a little below the edge; over stays over a little above it.
    expect(dockLayout({ viewport: 1300, room: EDGE - DOCK_HYSTERESIS, previous: 'docked' })).toBe('docked');
    expect(dockLayout({ viewport: 1300, room: EDGE - DOCK_HYSTERESIS - 1, previous: 'docked' })).toBe('over');
    expect(dockLayout({ viewport: 1300, room: EDGE + DOCK_HYSTERESIS - 1, previous: 'over' })).toBe('over');
    expect(dockLayout({ viewport: 1300, room: EDGE + DOCK_HYSTERESIS, previous: 'over' })).toBe('docked');
    // With no layout yet, the edge itself decides.
    expect(dockLayout({ viewport: 1300, room: EDGE })).toBe('docked');
    expect(dockLayout({ viewport: 1300, room: EDGE - 1 })).toBe('over');
    // Out of a sheet, the same.
    expect(dockLayout({ viewport: 1300, room: EDGE, previous: 'sheet' })).toBe('docked');
  });
});
