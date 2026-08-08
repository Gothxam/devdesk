/**
 * Local guard benchmarks for the theme pipeline.
 *
 * ## These are NOT ADR-0002 budgets
 *
 * They run on a developer machine, which ADR-0002 MM-1 makes **informational,
 * not normative**. The authoritative theme budget is `PB-R4` — full desktop
 * restyled within its threshold, measured on the reference machine under the W2
 * workload — and nothing here can pass or fail it.
 *
 * They exist because a baseline that catches a 10x regression on the developer's
 * own machine is worth having long before the reference runner is commissioned.
 * A pipeline stage that silently goes quadratic is caught here in seconds.
 *
 * Promoting any of these to a real `PB-*` budget requires an ADR-0002 amendment
 * carrying an id, a workload, a statistic, a validation class, a harness
 * assignment, and a position in the gate schedule (RV-5). Adding a number here
 * deliberately does not create a budget — a second, unenforced target register
 * is exactly the failure ADR-0002 exists to prevent.
 *
 * Provisional guard thresholds, per stage:
 *
 * | Stage      | Guard    |
 * | ---------- | -------- |
 * | Resolution | < 2 ms   |
 * | Diff       | < 0.5 ms |
 * | Emission   | < 1 ms   |
 * | Full switch| < 8 ms   |
 */

import { bench, describe } from 'vitest';

import { diffSnapshots } from './diff';
import { emitDiff } from './emit';
import { createSnapshotPool } from './intern';
import { resolveTheme } from './resolve';
import { NO_ACCESSIBILITY_PREFERENCES } from './preferences';
import { type ThemeSource, type TokenSet, literal, reference } from './token';

/** A theme roughly the size a real one reaches: 120 base, 120 semantic. */
function syntheticTheme(): ThemeSource {
  const base: Record<string, ReturnType<typeof literal>> = {};
  const semantic: Record<string, ReturnType<typeof reference>> = {};

  for (let i = 0; i < 120; i += 1) {
    base[`color.p${i}`] = literal('color', `#${(i * 7919).toString(16).padStart(6, '0').slice(0, 6)}`);
    semantic[`surface.s${i}`] = reference('color', `color.p${i}`);
  }

  const set: TokenSet = { base, semantic, component: {} };
  const light: TokenSet = { base, semantic, component: {} };
  return { id: 'bench', name: 'Bench', modes: { dark: set, light } };
}

const SOURCE = syntheticTheme();
const CTX = { mode: 'dark' as const, accessibility: NO_ACCESSIBILITY_PREFERENCES };
const LIGHT_CTX = { mode: 'light' as const, accessibility: NO_ACCESSIBILITY_PREFERENCES };

const warm = createSnapshotPool();
const A = warm.resolve(SOURCE, CTX);
const B = warm.resolve(SOURCE, LIGHT_CTX);
if (!A.ok || !B.ok) throw new Error('benchmark fixture failed to resolve');

describe('theme pipeline', () => {
  // Guard: < 2 ms
  bench('resolve 240 tokens', () => {
    resolveTheme(SOURCE, CTX);
  });

  // Guard: < 0.5 ms
  bench('diff two snapshots', () => {
    diffSnapshots(A.value, B.value);
  });

  // Guard: < 0.5 ms — the interned path should be effectively free.
  bench('diff identical snapshots (interned)', () => {
    diffSnapshots(A.value, A.value);
  });

  // Guard: < 1 ms
  bench('emit a full patch', () => {
    emitDiff(diffSnapshots(undefined, A.value));
  });

  // Guard: < 8 ms — resolve, diff, emit, end to end on a cold pool.
  bench('full switch on a cold pool', () => {
    const pool = createSnapshotPool();
    const from = pool.resolve(SOURCE, CTX);
    const to = pool.resolve(SOURCE, LIGHT_CTX);
    if (from.ok && to.ok) emitDiff(diffSnapshots(from.value, to.value));
  });
});
