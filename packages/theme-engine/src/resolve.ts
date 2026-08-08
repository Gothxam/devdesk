/**
 * Token resolution.
 *
 * This module is the whole engine. It is **pure**: it knows nothing about the
 * DOM, about CSS, about React, or about surfaces. It takes authored tokens and a
 * context, and returns an immutable snapshot or a typed error.
 *
 * The engine carries **no visual opinions** (D-8) and **no widget-specific
 * knowledge** (B-11, §22). It cannot name a widget, and adding a branch that did
 * would be a design-debt violation rather than a feature.
 *
 * Resolution is **total** (TH-3): every reference resolves to a concrete value or
 * a declared fallback. An unresolvable token fails here, at load, rather than
 * producing a blank region at paint.
 */

import { type Result, err, ok } from '@devdesk/shared';

import { type ThemeSnapshot, type ValueOrigin, freezeSnapshot } from './snapshot';
import {
  LAYERS,
  type ThemeMode,
  type ThemeSource,
  type TokenId,
  type TokenLayer,
  type TokenValue,
  layerRank,
  tokenId,
} from './token';

/** Operating-system preferences that override theme values unconditionally. */
export interface AccessibilityPreferences {
  readonly reducedMotion: boolean;
  readonly reducedTransparency: boolean;
  readonly highContrast: boolean;
}

export const NO_ACCESSIBILITY_PREFERENCES: AccessibilityPreferences = Object.freeze({
  reducedMotion: false,
  reducedTransparency: false,
  highContrast: false,
});

export interface ResolutionContext {
  readonly mode: ThemeMode;
  readonly accessibility: AccessibilityPreferences;
}

/**
 * Why resolution failed.
 *
 * ERR-2 applied to the engine: each variant tells the author what to fix. A
 * variant that only said "invalid theme" would be a design defect.
 */
export type ResolutionError =
  | { readonly kind: 'unknown-reference'; readonly from: TokenId; readonly to: TokenId }
  | { readonly kind: 'cycle'; readonly path: readonly TokenId[] }
  | {
      readonly kind: 'layer-inversion';
      readonly from: TokenId;
      readonly fromLayer: TokenLayer;
      readonly to: TokenId;
      readonly toLayer: TokenLayer;
    }
  | { readonly kind: 'base-token-is-reference'; readonly token: TokenId }
  | { readonly kind: 'unknown-mode'; readonly mode: string };

/** Renders a {@link ResolutionError} as an author-actionable message (EM-6). */
export function describeResolutionError(error: ResolutionError): string {
  switch (error.kind) {
    case 'unknown-reference':
      return `Token "${error.from}" references "${error.to}", which no layer defines. Define it, or give the reference a fallback.`;
    case 'cycle':
      return `Token reference cycle: ${error.path.join(' → ')}. A token cannot resolve through itself.`;
    case 'layer-inversion':
      return `Token "${error.from}" (${error.fromLayer}) references "${error.to}" (${error.toLayer}). References go component → semantic → base only.`;
    case 'base-token-is-reference':
      return `Base token "${error.token}" is a reference. Base tokens are primitives and must be literals.`;
    case 'unknown-mode':
      return `This theme does not define the "${error.mode}" mode.`;
  }
}

interface Entry {
  readonly value: TokenValue;
  readonly layer: TokenLayer;
}

function flatten(source: ThemeSource, mode: ThemeMode): Map<TokenId, Entry> | undefined {
  const set = source.modes[mode];
  if (set === undefined) return undefined;

  const flat = new Map<TokenId, Entry>();
  for (const layer of LAYERS) {
    for (const [name, value] of Object.entries(set[layer])) {
      // Later layers shadow earlier ones by design: that is the cascade.
      flat.set(tokenId(name), { value, layer });
    }
  }
  return flat;
}

/**
 * Resolves one theme into an immutable snapshot.
 *
 * Cycles are detected by depth-first traversal with an explicit visiting set,
 * and the reported path is the actual cycle rather than the token that happened
 * to be visited first — an author fixing a cycle needs to see the loop.
 */
export function resolveTheme(
  source: ThemeSource,
  context: ResolutionContext,
  overrides: ReadonlyMap<TokenId, string> = new Map(),
): Result<ThemeSnapshot, ResolutionError> {
  const flat = flatten(source, context.mode);
  if (flat === undefined) {
    return err({ kind: 'unknown-mode', mode: context.mode });
  }

  const resolved = new Map<TokenId, string>();
  const origins = new Map<TokenId, ValueOrigin>();
  const visiting = new Set<TokenId>();
  const path: TokenId[] = [];

  function resolveOne(id: TokenId): Result<string, ResolutionError> {
    const cached = resolved.get(id);
    if (cached !== undefined) return ok(cached);

    if (visiting.has(id)) {
      const start = path.indexOf(id);
      return err({ kind: 'cycle', path: [...path.slice(start), id] });
    }

    const entry = flat?.get(id);
    if (entry === undefined) {
      // Reached only via a reference; the caller reports which token pointed here.
      return err({ kind: 'unknown-reference', from: id, to: id });
    }

    if (entry.value.kind === 'literal') {
      resolved.set(id, entry.value.value);
      origins.set(id, 'theme');
      return ok(entry.value.value);
    }

    if (entry.layer === 'base') {
      return err({ kind: 'base-token-is-reference', token: id });
    }

    const target = entry.value.to;
    const targetEntry = flat?.get(target);

    if (targetEntry === undefined) {
      // TH-3 totality: a declared fallback keeps resolution total.
      if (entry.value.fallback !== undefined) {
        resolved.set(id, entry.value.fallback);
        origins.set(id, 'fallback');
        return ok(entry.value.fallback);
      }
      return err({ kind: 'unknown-reference', from: id, to: target });
    }

    if (layerRank(targetEntry.layer) >= layerRank(entry.layer)) {
      return err({
        kind: 'layer-inversion',
        from: id,
        fromLayer: entry.layer,
        to: target,
        toLayer: targetEntry.layer,
      });
    }

    visiting.add(id);
    path.push(id);
    const inner = resolveOne(target);
    path.pop();
    visiting.delete(id);

    if (!inner.ok) return inner;

    resolved.set(id, inner.value);
    origins.set(id, 'theme');
    return ok(inner.value);
  }

  for (const id of flat.keys()) {
    const outcome = resolveOne(id);
    if (!outcome.ok) return err(outcome.error);
  }

  // D-5 / TH-5: accessibility overrides are applied LAST and unconditionally.
  // Applying them after resolution is what makes them un-shadowable: a theme has
  // no phase in which it could observe or replace them.
  const overridden = new Set<TokenId>();
  for (const [id, value] of overrides) {
    resolved.set(id, value);
    origins.set(id, 'accessibility-override');
    overridden.add(id);
  }

  return ok(
    freezeSnapshot({
      themeId: source.id,
      themeName: source.name,
      mode: context.mode,
      tokens: resolved,
      origins,
      accessibilityOverrides: overridden,
    }),
  );
}
