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

import { hashThemeInputs } from './hash';
import type { AccessibilityPreferences } from './preferences';
import {
  THEME_SNAPSHOT_VERSION,
  type ThemeSnapshot,
  type ValueOrigin,
  freezeSnapshot,
} from './snapshot';
import {
  LAYERS,
  type ThemeMode,
  type ThemeSource,
  type TokenDefinition,
  type TokenId,
  type TokenKind,
  type TokenLayer,
  layerRank,
  isTokenKind,
  tokenId,
} from './token';

export type { AccessibilityPreferences };

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
  | { readonly kind: 'unknown-token-kind'; readonly token: TokenId; readonly declared: string }
  | {
      readonly kind: 'kind-mismatch';
      readonly from: TokenId;
      readonly fromKind: TokenKind;
      readonly to: TokenId;
      readonly toKind: TokenKind;
    }
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
    case 'unknown-token-kind':
      return `Token "${error.token}" declares kind "${error.declared}", which is not a known kind. This is usually a typo — a token with an unknown kind is never accessibility-overridden.`;
    case 'kind-mismatch':
      return `Token "${error.from}" is a ${error.fromKind} but references "${error.to}", which is a ${error.toKind}. A reference must preserve kind.`;
    case 'unknown-mode':
      return `This theme does not define the "${error.mode}" mode.`;
  }
}

interface Entry {
  readonly definition: TokenDefinition;
  readonly layer: TokenLayer;
}

function flatten(source: ThemeSource, mode: ThemeMode): Map<TokenId, Entry> | undefined {
  const set = source.modes[mode];
  if (set === undefined) return undefined;

  const flat = new Map<TokenId, Entry>();
  for (const layer of LAYERS) {
    for (const [name, definition] of Object.entries(set[layer])) {
      // Later layers shadow earlier ones by design: that is the cascade.
      flat.set(tokenId(name), { definition, layer });
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

    // A misdeclared kind is caught here rather than silently excluding the token
    // from accessibility overrides — which is the failure mode that made naming
    // conventions unsafe for this job.
    if (!isTokenKind(entry.definition.kind)) {
      return err({
        kind: 'unknown-token-kind',
        token: id,
        declared: String(entry.definition.kind),
      });
    }

    const form = entry.definition.value;

    if (form.form === 'literal') {
      resolved.set(id, form.value);
      origins.set(id, 'theme');
      return ok(form.value);
    }

    if (entry.layer === 'base') {
      return err({ kind: 'base-token-is-reference', token: id });
    }

    const target = form.to;
    const targetEntry = flat?.get(target);

    if (targetEntry === undefined) {
      // TH-3 totality: a declared fallback keeps resolution total.
      if (form.fallback !== undefined) {
        resolved.set(id, form.fallback);
        origins.set(id, 'fallback');
        return ok(form.fallback);
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

    // A reference must preserve kind. Only possible because the schema declares
    // it: a naming convention cannot tell a colour from a duration, so this class
    // of error was undetectable before.
    if (targetEntry.definition.kind !== entry.definition.kind) {
      return err({
        kind: 'kind-mismatch',
        from: id,
        fromKind: entry.definition.kind,
        to: target,
        toKind: targetEntry.definition.kind,
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
      version: THEME_SNAPSHOT_VERSION,
      hash: hashThemeInputs(source, context.mode, context.accessibility),
      tokens: resolved,
      origins,
      accessibilityOverrides: overridden,
      metadata: {
        themeId: source.id,
        themeName: source.name,
        mode: context.mode,
        tokenCount: resolved.size,
        overrideCount: overridden.size,
      },
    }),
  );
}
