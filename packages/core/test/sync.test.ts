import { describe, expect, it } from 'vitest';
import { decideDelete, decideFieldMerge, isMassDelete } from '../src/index.js';

describe('sync rules', () => {
  it('field merge: server wins only on fields it changed since base', () => {
    expect(decideFieldMerge({ title: 'A', parentId: 'p' }, new Set(['title']))).toEqual({ apply: { parentId: 'p' }, serverWon: ['title'], conflict: true });
    expect(decideFieldMerge({ title: 'A' }, new Set())).toEqual({ apply: { title: 'A' }, serverWon: [], conflict: false });
  });
  it('delete decision', () => {
    expect(decideDelete({ deleted: false, rev: 5 }, 5)).toBe('delete');
    expect(decideDelete({ deleted: false, rev: 7 }, 5)).toBe('keep-conflict');
    expect(decideDelete({ deleted: true, rev: 7 }, 5)).toBe('noop');
  });
  it('mass delete threshold', () => {
    expect(isMassDelete(4, 10)).toBe(false); // 최소 5개
    expect(isMassDelete(5, 25)).toBe(true); // 20%
    expect(isMassDelete(5, 26)).toBe(false);
    expect(isMassDelete(100, 0)).toBe(false);
  });
});
