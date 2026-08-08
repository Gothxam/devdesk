#!/usr/bin/env node
/**
 * GEN-2: regenerates the contract and fails if the committed output differs.
 *
 * The generated contract is committed so reviewers and AI agents can diff the
 * true API surface (§7.4). A drifted contract means the Rust signatures and the
 * TypeScript the shell compiles against disagree — which at a trust boundary is
 * a security problem, not a typing inconvenience (AP-13).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CONTRACT = 'packages/contracts/src/generated/contract.ts';

const before = readFileSync(CONTRACT, 'utf8');
execFileSync('cargo', ['run', '-q', '-p', 'devdesk-app', '--bin', 'export-contract'], {
  stdio: 'inherit',
});
const after = readFileSync(CONTRACT, 'utf8');

if (before !== after) {
  console.error(
    `\ncontract drift: ${CONTRACT} is out of date.\n\n` +
      `The committed contract does not match the Rust command signatures. Regenerate ` +
      `and commit the result:\n\n  cargo run -p devdesk-app --bin export-contract\n\n` +
      `GEN-1 prohibits hand-editing generated output; the Rust signatures are the ` +
      `definitional API (DD-003).`,
  );
  process.exit(1);
}

console.log('contract: no drift.');
