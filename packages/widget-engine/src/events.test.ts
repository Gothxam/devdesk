import { fallbackSnapshot } from '@devdesk/theme-engine';
import { describe, expect, it, vi } from 'vitest';

import { createEventChannel, type WidgetEvent } from './events';

const THEME_CHANGED: WidgetEvent = { kind: 'theme-changed', theme: fallbackSnapshot('light') };
const SUSPENDED: WidgetEvent = { kind: 'suspended' };

describe('createEventChannel', () => {
  it('delivers synchronously, in subscription order', () => {
    // Synchronous delivery makes a theme change and the render that follows it
    // one observable step, with no scheduling to wait on (TS-6).
    const order: number[] = [];
    const channel = createEventChannel();

    channel.subscribe(() => order.push(1));
    channel.subscribe(() => order.push(2));
    channel.subscribe(() => order.push(3));

    channel.publish(SUSPENDED);
    expect(order).toEqual([1, 2, 3]);
  });

  it('stops delivering after unsubscribe', () => {
    const channel = createEventChannel();
    const listener = vi.fn();

    const unsubscribe = channel.subscribe(listener);
    channel.publish(SUSPENDED);
    unsubscribe();
    channel.publish(SUSPENDED);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes idempotently, without removing an equal listener', () => {
    // A widget that unsubscribes in a destroy handler and again in a cleanup
    // must not take a later, identical listener with it.
    const channel = createEventChannel();
    const shared = vi.fn();

    const first = channel.subscribe(shared);
    channel.subscribe(shared);

    first();
    first();

    channel.publish(SUSPENDED);
    expect(shared).toHaveBeenCalledTimes(1);
    expect(channel.listenerCount()).toBe(1);
  });

  it('contains a throwing listener and reports it', () => {
    // AC-ERR-2.2: one widget's bad handler must not stop another hearing about
    // a theme change. Nor may the failure be swallowed.
    const channel = createEventChannel();
    const after = vi.fn();

    channel.subscribe(() => {
      throw new Error('bad handler');
    });
    channel.subscribe(after);

    const failures = channel.publish(THEME_CHANGED);

    expect(after).toHaveBeenCalledTimes(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.event).toBe(THEME_CHANGED);
    expect((failures[0]?.error as Error).message).toBe('bad handler');
  });

  it('reports nothing when every listener behaves', () => {
    const channel = createEventChannel();
    channel.subscribe(vi.fn());
    expect(channel.publish(SUSPENDED)).toEqual([]);
  });

  it('does not let a handler change who receives the event it is handling', () => {
    // Otherwise delivery order depends on handler side effects.
    const channel = createEventChannel();
    const late = vi.fn();

    channel.subscribe(() => {
      channel.subscribe(late);
    });

    channel.publish(SUSPENDED);
    expect(late).not.toHaveBeenCalled();

    channel.publish(SUSPENDED);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('delivers nothing once closed', () => {
    const channel = createEventChannel();
    const listener = vi.fn();
    channel.subscribe(listener);

    channel.close();
    expect(channel.publish(SUSPENDED)).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect(channel.listenerCount()).toBe(0);
  });

  it('ignores a subscription made after closing', () => {
    const channel = createEventChannel();
    channel.close();

    const unsubscribe = channel.subscribe(vi.fn());
    expect(channel.listenerCount()).toBe(0);
    expect(() => unsubscribe()).not.toThrow();
  });

  it('gives each instance its own channel', () => {
    // WR-2 applied to events: a widget cannot learn that another widget's theme
    // changed, because the only channel it can reach is its own.
    const first = createEventChannel();
    const second = createEventChannel();
    const heard = vi.fn();

    second.subscribe(heard);
    first.publish(THEME_CHANGED);

    expect(heard).not.toHaveBeenCalled();
  });
});
