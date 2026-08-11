/**
 * Which display a shell composes on, and in whose coordinates.
 *
 * The two modes answer differently and both have to be right: window mode
 * composes on the primary, and a desktop host window composes on the monitor it
 * was created for (`ADR-0005` `DH-13`). A host window that fell back to the
 * primary would place its widgets off the side of a second screen.
 */

import { describe, expect, it } from 'vitest';

import { FALLBACK_DISPLAY_ID, selectDisplay, type ReportedDisplay } from './displays';

function monitor(overrides: Partial<ReportedDisplay> & Pick<ReportedDisplay, 'id'>): ReportedDisplay {
  return {
    name: overrides.id,
    is_primary: false,
    scale_factor: 1,
    work_area: { x: 0, y: 0, width: 1920, height: 1040 },
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    ...overrides,
  };
}

const VIEWPORT = { width: 1280, height: 800 };

/** Window mode: no host monitor was named. */
const WINDOW_MODE = undefined;

describe('window mode', () => {
  it('composes on the primary', () => {
    const display = selectDisplay(
      [
        monitor({ id: 'second', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }),
        monitor({ id: 'first', is_primary: true }),
      ],
      WINDOW_MODE,
      VIEWPORT,
    );

    expect(display.monitorId).toBe('first');
    expect(display.isFallback).toBe(false);
  });

  it('takes the first display when nothing is marked primary', () => {
    // A real state on some remote sessions. Composing on nothing would be worse
    // than composing on the first display the identity order names.
    expect(selectDisplay([monitor({ id: 'only' })], WINDOW_MODE, VIEWPORT).monitorId).toBe('only');
  });

  it('leaves the work area where it was', () => {
    // The mode that has always worked must keep working: a window-mode shell
    // treats the work area as its own origin, which makes the conversion the
    // identity.
    const display = selectDisplay(
      [monitor({ id: 'only', work_area: { x: 0, y: 40, width: 1920, height: 1000 } })],
      WINDOW_MODE,
      VIEWPORT,
    );

    expect(display.workArea.x).toBe(0);
    expect(display.workArea.y).toBe(0);
    expect(display.workArea.width).toBe(1920);
  });
});

describe('desktop mode', () => {
  it('composes on the monitor the host window was created for', () => {
    // DH-13: one host window per monitor. Falling back to the primary here
    // would lay the second screen out against the first one's work area.
    const display = selectDisplay(
      [
        monitor({ id: 'primary', is_primary: true }),
        monitor({
          id: 'right',
          work_area: { x: 1920, y: 0, width: 1920, height: 1040 },
          bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        }),
      ],
      'right',
      VIEWPORT,
    );

    expect(display.monitorId).toBe('right');
  });

  it('returns a work area relative to the window, not the virtual screen', () => {
    // The composed surfaces are positioned inside this window. A work area at
    // virtual x=1920 would put every widget a screen-width off the right edge.
    const display = selectDisplay(
      [
        monitor({
          id: 'right',
          work_area: { x: 1920, y: 40, width: 1920, height: 1000 },
          bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        }),
      ],
      'right',
      VIEWPORT,
    );

    expect(display.workArea.x).toBe(0);
    expect(display.workArea.y).toBe(40);
    expect(display.workArea.width).toBe(1920);
    expect(display.workArea.height).toBe(1000);
  });

  it('keeps a left-of-primary monitor at the origin of its own window', () => {
    // DH-14: a monitor left of the primary has a negative origin in virtual
    // space, and the subtraction is what turns that into a window coordinate.
    const display = selectDisplay(
      [
        monitor({
          id: 'left',
          work_area: { x: -1920, y: 0, width: 1920, height: 1040 },
          bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
        }),
      ],
      'left',
      VIEWPORT,
    );

    expect(display.workArea.x).toBe(0);
    expect(display.workArea.y).toBe(0);
  });

  it('carries this monitors scale, not the primarys', () => {
    // WD-2: scale is per-monitor. A host window on a 150% display that reported
    // the primary's 100% would compose everything a third too small.
    const display = selectDisplay(
      [
        monitor({ id: 'primary', is_primary: true, scale_factor: 1 }),
        monitor({ id: 'hidpi', scale_factor: 1.5 }),
      ],
      'hidpi',
      VIEWPORT,
    );

    expect(display.scaleFactor).toBe(1.5);
  });

  it('falls back to a real display when its monitor has been unplugged', () => {
    // The window is about to be destroyed by the next topology transaction. One
    // frame on the wrong real display beats one frame claiming the hardware is
    // a browser.
    const display = selectDisplay(
      [monitor({ id: 'primary', is_primary: true })],
      'unplugged',
      VIEWPORT,
    );

    expect(display.monitorId).toBe('primary');
    expect(display.isFallback).toBe(false);
  });
});

describe('degraded', () => {
  it('stands in when no display is attached', () => {
    // A closed lid with nothing plugged in. A real state, not an error, and the
    // stand-in is unmistakably not hardware.
    const display = selectDisplay([], WINDOW_MODE, VIEWPORT);

    expect(display.isFallback).toBe(true);
    expect(display.monitorId).toBe(FALLBACK_DISPLAY_ID);
    expect(display.workArea.width).toBe(VIEWPORT.width);
    expect(display.workArea.height).toBe(VIEWPORT.height);
  });

  it('stands in for a display whose identity the core cannot express', () => {
    // An empty id would fail `monitorId` parsing. Composing against a display
    // that cannot be named would produce surfaces nothing could later find.
    expect(selectDisplay([monitor({ id: '' })], WINDOW_MODE, VIEWPORT).isFallback).toBe(true);
  });
});
