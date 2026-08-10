import { describe, expect, it } from 'vitest';

import { glassStyle, needsGlass } from './glass';

describe('glassStyle', () => {
  it('turns intent into custom properties', () => {
    const style = glassStyle({ opacity: 0.85, blurRadius: 24, tint: '#10121680' });

    expect(style['--surface-opacity']).toBe('0.85');
    expect(style['--surface-backdrop']).toBe('blur(24px)');
    expect(style['--surface-tint']).toBe('#10121680');
  });

  it('emits none rather than an empty backdrop-filter', () => {
    // An empty backdrop-filter is invalid CSS: the property would be ignored
    // and whatever was set before would keep applying.
    const style = glassStyle({ opacity: 1, blurRadius: 0, tint: undefined });

    expect(style['--surface-backdrop']).toBe('none');
    expect(style['--surface-tint']).toBe('transparent');
  });

  it('clamps rather than emitting invalid CSS', () => {
    const style = glassStyle({ opacity: 7, blurRadius: -3, tint: undefined });
    expect(style['--surface-opacity']).toBe('1');
    expect(style['--surface-backdrop']).toBe('none');

    const nan = glassStyle({ opacity: Number.NaN, blurRadius: Number.NaN, tint: undefined });
    expect(nan['--surface-opacity']).toBe('1');
    expect(nan['--surface-backdrop']).toBe('none');
  });
});

describe('needsGlass', () => {
  it('is false for a plain opaque surface', () => {
    // An opaque surface should not pay for the layer a backdrop-filter forces.
    expect(needsGlass({ opacity: 1, blurRadius: 0, tint: undefined })).toBe(false);
  });

  it('is true the moment anything glassy is asked for', () => {
    expect(needsGlass({ opacity: 0.9, blurRadius: 0, tint: undefined })).toBe(true);
    expect(needsGlass({ opacity: 1, blurRadius: 8, tint: undefined })).toBe(true);
    expect(needsGlass({ opacity: 1, blurRadius: 0, tint: '#fff' })).toBe(true);
  });
});
