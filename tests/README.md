# `tests/`

Cross-cutting suites only. **Unit tests are colocated with the code they test**
(ADR-0003 RL-12): `#[cfg(test)]` modules in `crates/*/src/`, and `*.test.ts` /
`*.spec.tsx` beside their source in `packages/*/src/`. A unit test in here is a
unit test that has lost its subject.

`tests` is a single pnpm workspace package, not a glob (RL-10): the suites share
fixtures, harness utilities, and the ADR-0002 workload definitions.

| Directory | Scope | Runs on |
| --- | --- | --- |
| `contract/` | IPC schema conformance, both directions (TS-1) | Every commit |
| `platform/` | `PlatformBackend` semantic parity, per OS (XP-5) | Every commit, per OS |
| `integration/` | Core + storage + plugin host, no UI | Every PR |
| `e2e/` | Real windows, real monitors (virtualized) | Every PR |
| `perf/` | ADR-0002 budget harnesses | Every PR, reference runner |
| `security/` | Capability bypass, impersonation, fuzz corpora (TS-8) | Every PR + nightly |

## Why there is no `typecheck` script yet

`tsconfig.json` is present and correct, but no script references it: TypeScript
fails with `TS18003` when `include` matches zero files, and `tests/` holds no
TypeScript until the first suite lands. A script that cannot pass is not a gate
— it is a broken build waiting to be ignored. The script is added with the first
suite, and the root `check:types` gate covers `packages/*` until then.
