import { describe, expect, it } from 'vitest';

import { cn, cssVars } from './cn.js';

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('inline-flex', 'items-center')).toBe('inline-flex items-center');
  });

  it('drops falsy conditional values', () => {
    const hidden = false as boolean;
    const count = 0 as number;
    expect(cn('base', hidden && 'hidden', undefined, null, count > 0 && 'has-items')).toBe('base');
  });

  it('lets the last conflicting Tailwind utility win (tailwind-merge)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('bg-surface', 'bg-surface-2')).toBe('bg-surface-2');
  });

  it('keeps non-conflicting utilities from both sides', () => {
    expect(cn('ps-2 text-fg', 'pe-2')).toBe('ps-2 text-fg pe-2');
  });

  it('accepts arrays and objects like clsx', () => {
    expect(cn(['a', { b: true, c: false }])).toBe('a b');
  });
});

describe('cssVars', () => {
  it('passes through custom-property keys and stringifies numbers', () => {
    expect(cssVars({ '--progress': 42, '--avatar-from': '#fff' })).toEqual({
      '--progress': '42',
      '--avatar-from': '#fff',
    });
  });

  it('drops null and undefined values', () => {
    expect(cssVars({ '--a': null, '--b': undefined, '--c': '1' })).toEqual({ '--c': '1' });
  });
});
