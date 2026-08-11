/**
 * End-to-end frame latency through the whole assembled desktop.
 *
 * ## What "end to end" means here, precisely
 *
 * From a cause entering the pipeline to the frame being presented, through
 * every real component: widget host, scheduler, composition scene,
 * invalidation, occlusion cull, compositor. It stops at `onFrame`.
 *
 * **React's commit and the browser's paint are not in these numbers**, and
 * cannot be — this runs in Node, and there is no DOM. So this measures the part
 * DevDesk owns and can regress, not the part the browser owns. Stated plainly
 * because "end-to-end frame latency" could easily be read as including the
 * paint, and it does not.
 *
 * `PB-R2` budgets a frame at 16.6 ms on a 60 Hz display. What these numbers
 * answer is how much of that the pipeline spends before the renderer is even
 * handed anything.
 *
 * Informational under `ADR-0002` `D-2`/`MM-1`: developer machine, tinybench
 * rather than the §8.5 statistic.
 */

import { monitorId } from '@devdesk/contracts';
import { fallbackSnapshot, type ThemeSnapshot } from '@devdesk/theme-engine';
import { createManualTimer, rect } from '@devdesk/widget-engine';
import { bench, describe } from 'vitest';

import { DesktopController } from './controller';
import type { ShellDisplay } from './displays';

const START = new Date('2026-08-10T09:05:00').getTime();

function display(): ShellDisplay {
  const id = monitorId('unit:SN-BENCH');
  if (!id.ok) throw new Error('fixture');

  return {
    monitorId: id.value,
    name: 'Bench 27',
    isPrimary: true,
    scaleFactor: 1,
    workArea: rect(0, 0, 2560, 1400),
    isFallback: false,
  };
}

/** A theme with glass, so a switch actually changes the composition. */
function glassy(mode: 'dark' | 'light'): ThemeSnapshot {
  const base = fallbackSnapshot(mode);
  return {
    ...base,
    hash: `bench-glass-${mode}`,
    tokens: new Map([
      ...base.tokens,
      ['surface.glass.opacity' as never, mode === 'dark' ? '0.82' : '0.9'],
      ['surface.glass.blur' as never, mode === 'dark' ? '18' : '24'],
    ]),
  };
}

/** A placed, revealed desktop with its frame source under test control. */
async function desktop() {
  const queue: (() => void)[] = [];
  const timer = createManualTimer(START);
  let frames = 0;

  const controller = new DesktopController({
    theme: glassy('dark'),
    display: display(),
    timer,
    frameSource: (callback) => queue.push(callback),
    callbacks: {
      onFrame: () => {
        frames += 1;
      },
      onViews: () => undefined,
    },
  });

  await controller.place(timer.now());
  controller.markPainted();

  const fire = () => {
    for (const callback of queue.splice(0, queue.length)) callback();
  };
  fire();

  return { controller, timer, fire, frames: () => frames };
}

// Built at module scope: a `describe` callback cannot be async, and each
// benchmark needs a desktop that is already placed and revealed so the
// measurement is of the steady-state path rather than of startup.
const ready = await desktop();
const ticking = await desktop();
const hitting = await desktop();
const composing = await desktop();

describe('end-to-end frame latency', () => {
  let toLight = false;
  bench('theme switch → frame presented', () => {
    // The full path: host rebuilds three contexts, scheduler marks three
    // widgets dirty, scene rebuilds with new glass, invalidation diffs, frame
    // presents. Everything except React and the paint.
    toLight = !toLight;
    ready.controller.applyTheme(glassy(toLight ? 'light' : 'dark'));
    ready.controller.flushFrame();
  });

  bench('one second of clock cadence → views updated', () => {
    // Three clocks, one wake-up, three updates, three renders. No frame: the
    // clocks' *content* changed and the composition did not, which is the
    // separation the architecture rests on.
    ticking.timer.advance(1_000);
  });

  bench('hit test through the composed scene', () => {
    hitting.controller.hitAt({ x: 250, y: 150 });
  });

  bench('present a frame with nothing owed', () => {
    // The floor: what asking for a frame costs when the desktop is settled.
    composing.controller.flushFrame();
  });
});
