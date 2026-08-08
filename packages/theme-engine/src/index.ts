/**
 * `@devdesk/theme-engine` — public surface.
 *
 * A **token-resolution system**, not a CSS theme system. The engine is pure: it
 * takes authored tokens and a context and returns an immutable snapshot. It
 * knows nothing about the DOM, about CSS, about React, or about surfaces.
 *
 * CSS custom properties are one *emission target* of a resolved snapshot, not
 * the model — see `emit.ts`. Applying them to a document is the shell's job.
 *
 * The engine carries no visual opinions (D-8) and no widget-specific logic
 * (B-11, §22). It cannot name a widget.
 */

export {
  type ThemeMode,
  type ThemeSource,
  type TokenId,
  type TokenLayer,
  type TokenSet,
  type TokenDefinition,
  type TokenKind,
  type TokenValueForm,
  LAYERS,
  TOKEN_KINDS,
  isTokenKind,
  layerRank,
  literal,
  reference,
  tokenId,
} from './token';

export {
  type ThemeSnapshot,
  type ValueOrigin,
  freezeSnapshot,
  readToken,
} from './snapshot';

export {
  type AccessibilityPreferences,
  type ResolutionContext,
  type ResolutionError,
  NO_ACCESSIBILITY_PREFERENCES,
  describeResolutionError,
  resolveTheme,
} from './resolve';

export {
  type CustomPropertyPatch,
  customPropertyName,
  emitDiff,
  findUnemittableTokenIds,
  isEmittableTokenId,
  isEmptyPatch,
} from './emit';

export { type ThemeDiff, diffSnapshots, isEmptyDiff } from './diff';

export { type SnapshotPool, createSnapshotPool } from './intern';

export {
  accessibilityOverrides,
  declaredTokens,
  describeActiveOverrides,
  hasActiveOverrides,
} from './accessibility';

export { type ThemeParseError, describeThemeParseError, parseThemeSource } from './parse';
