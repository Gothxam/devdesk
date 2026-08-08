# `themes/`

First-party themes. **Data only** (TH-1): no JavaScript, no WASM, no scripting
hooks, no expression language with side effects. A theme install must never be
able to become code execution, because themes are the lowest-friction thing
anyone installs and therefore the highest-value attack surface on the platform.

This directory is deliberately **not** a pnpm workspace member (ADR-0003 RL-8).
Listing it would imply buildability and create the affordance TH-1 exists to
foreclose — a theme has no `package.json` and no build step.

## What the bundled themes are for

They validate the token system, inheritance, the emission pipeline, and runtime
switching. They contain no glass effects, no animation presets, no component
styling rules, and no widget-specific tokens: those arrive alongside the effects
and surfaces that need them, not ahead of them.

Both themes define only `base` and `semantic` layers. The `component` layer is
empty on purpose — there are no components yet, and inventing component tokens
for widgets that do not exist would be a placeholder (§25.3).

## Token kinds

Every token declares its `kind`. The engine acts on the declared kind and never
infers meaning from a token's name, so accessibility overrides cannot be missed
by a typo. See `packages/theme-engine/src/token.ts` for the closed set.
