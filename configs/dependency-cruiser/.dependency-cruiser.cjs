/**
 * Enforces DR-1…DR-5 (SYSTEM_ARCHITECTURE.md §6.3) by path.
 *
 * ADR-0003 R-7: a path-based rule that matches nothing passes silently. Every
 * rule below is paired with a non-empty match assertion in CI, so a rule that
 * has stopped applying fails rather than passes.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'DR-1: the dependency graph MUST be acyclic.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'shared-is-pure',
      severity: 'error',
      comment:
        'DR-3: @devdesk/shared has zero runtime dependencies and no React, DOM, or Tauri imports. ' +
        'A runtime dependency here becomes transitive for every plugin ever written (PK-5).',
      from: { path: '^packages/shared/' },
      to: { dependencyTypes: ['npm'] },
    },
    {
      name: 'sdk-surface-is-minimal',
      severity: 'error',
      comment:
        'DR-4: @devdesk/plugin-sdk depends only on shared and contracts. The contracts ' +
        'dependency is pending ADR-0014 — see planning/SPRINT_1.md §3.1.',
      from: { path: '^packages/plugin-sdk/' },
      to: { path: '^packages/(?!shared|contracts|plugin-sdk)' },
    },
    {
      name: 'no-deep-imports',
      severity: 'error',
      comment:
        'DR-5: only the published entry point of a package is importable. A deep import ' +
        'means a refactor inside one package breaks three others (AP-4).',
      from: {},
      to: { path: '^packages/[^/]+/src/(?!index\.ts$)' },
    },
    {
      name: 'no-upward-layer-imports',
      severity: 'error',
      comment: 'DR-2: dependencies flow downward through layers only.',
      from: { path: '^packages/(shared|contracts|theme-engine|animation|storage)/' },
      to: { path: '^packages/(ui|widget-engine|effects|hooks)/' },
    },
    {
      name: 'no-playground-in-production',
      severity: 'error',
      comment:
        'RL-9: playground/ is excluded from the workspace so this cannot resolve. This rule ' +
        'catches a relative-path escape.',
      from: { pathNot: '^playground/' },
      to: { path: '^playground/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'configs/typescript/base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'types'] },
  },
};
