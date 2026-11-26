import { SESSIONS_KEY } from '@everyfold/core';
import type { NodeRow } from './store.js';

/**
 * 세션 폴더(cat_key='sessions')와 그 아래 폴더 id. 이 안은 카테고리가 아니다 —
 * 분류 후보·학습 대상·정리 제안(apply_rules·remove_empty·new_category)·캡처 목적지·중복 URL 합치기에서 모두 뺀다.
 * folders 는 살아 있는 폴더 전부(store.liveFolders)여야 한다.
 */
export function sessionFolderIds(folders: readonly Pick<NodeRow, 'id' | 'parent_id' | 'cat_key' | 'deleted'>[]): Set<string> {
  const out = new Set<string>();
  const kids = new Map<string | null, string[]>();
  for (const f of folders) {
    if (f.deleted) continue;
    kids.set(f.parent_id, [...(kids.get(f.parent_id) ?? []), f.id]);
    if (f.cat_key === SESSIONS_KEY) out.add(f.id);
  }
  const stack = [...out];
  while (stack.length) {
    for (const c of kids.get(stack.pop()!) ?? []) {
      if (out.has(c)) continue;
      out.add(c);
      stack.push(c);
    }
  }
  return out;
}
