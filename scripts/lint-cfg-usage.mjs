#!/usr/bin/env node
/**
 * Enforces DR-6 (SYSTEM_ARCHITECTURE.md §6.3).
 *
 * Only `devdesk-platform` may use `#[cfg(target_os = ...)]` to select
 * implementations. Other crates may use `cfg` for test gating only.
 *
 * Rationale (AP-15): a platform difference expressed as a silent `cfg` produces a
 * feature that "does nothing" on one OS, with no error and no log, reproducing
 * only on the operating system nobody on the team uses. Platform divergence goes
 * through `PlatformBackend` and reports itself as `Unsupported` with a reason.
 *
 * ADR-0003 R-7: this lint asserts it actually scanned something. A path-based
 * check that matches nothing passes silently, which is worse than no check.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const CRATES_DIR = 'crates';
const EXEMPT_CRATE = 'devdesk-platform';
const TARGET_OS_CFG = /#\[\s*cfg\s*\(\s*(?:not\s*\(\s*)?target_os\s*=/;
const TEST_GATED = /#\[\s*cfg\s*\(\s*(?:test|all\s*\(\s*test)/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'target' || entry === 'node_modules') continue;
      out.push(...walk(full));
    } else if (entry.endsWith('.rs')) {
      out.push(full);
    }
  }
  return out;
}

let scanned = 0;
const violations = [];

for (const file of walk(CRATES_DIR)) {
  scanned += 1;
  const crate = relative(CRATES_DIR, file).split(sep)[0];
  if (crate === EXEMPT_CRATE) continue;

  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (TARGET_OS_CFG.test(line) && !TEST_GATED.test(line)) {
      violations.push({ file, line: i + 1, text: line.trim() });
    }
  });
}

// R-7: a check that scanned nothing has stopped applying and must fail.
if (scanned === 0) {
  console.error(
    `lint-cfg-usage: scanned 0 Rust files under ${CRATES_DIR}/. The rule has stopped ` +
      `applying — this is a lint failure, not a pass (ADR-0003 R-7).`,
  );
  process.exit(2);
}

if (violations.length > 0) {
  console.error(`lint-cfg-usage: DR-6 violated in ${violations.length} place(s).\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}\n    ${v.text}`);
  }
  console.error(
    `\nOnly ${EXEMPT_CRATE} may select implementations by target_os. Express the ` +
      `difference through PlatformBackend and return Unsupported with a reason (XP-3).`,
  );
  process.exit(1);
}

console.log(`lint-cfg-usage: DR-6 clean across ${scanned} Rust file(s).`);
