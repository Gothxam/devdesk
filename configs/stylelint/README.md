# Stylelint configuration

Enforces two architectural rules that cannot be enforced by types:

- **TH-6 / AP-3** — `backdrop-filter` is prohibited outside `packages/effects`.
  Glass is an effect the system grants, never one a component or plugin applies
  for itself (D-6). The override for `packages/effects` is the single exception.
- **TH-2 / AP-8** — no hardcoded colour literals. Every visual value is a token
  (P-4, D-4); a hex literal is invisible to the theme engine and produces a
  visual island under theme switching.
