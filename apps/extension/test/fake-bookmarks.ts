import type { BNode, BookmarksApi, EngineState, KV } from '../src/engine.js';

/** chrome.bookmarks 와 같은 모양의 메모리 북마크 트리(0=루트, 1=북마크바, 2=기타, 3=모바일) */
export class FakeBookmarks implements BookmarksApi {
  private nodes = new Map<string, { id: string; parentId?: string; title: string; url?: string; children?: string[] }>();
  private seq = 100;
  constructor(flavor: 'chrome' | 'firefox' = 'chrome') {
    const ids = flavor === 'chrome' ? ['1', '2', '3'] : ['toolbar_____', 'unfiled_____', 'mobile______'];
    const titles = flavor === 'chrome' ? ['Bookmarks bar', 'Other bookmarks', 'Mobile bookmarks'] : ['Bookmarks Toolbar', 'Other Bookmarks', 'Mobile Bookmarks'];
    this.nodes.set('0', { id: '0', title: '', children: [...ids] });
    ids.forEach((id, i) => this.nodes.set(id, { id, parentId: '0', title: titles[i]!, children: [] }));
  }
  ids = { bar: '', other: '' };
  /** 이 브라우저가 거부하는 URL(실제 브라우저의 "Invalid URL." 흉내) */
  rejectUrl: ((url: string) => boolean) | null = null;
  private out(id: string, deep: boolean): BNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Can't find bookmark for id. ${id}`);
    const parent = n.parentId ? this.nodes.get(n.parentId) : undefined;
    const b: BNode = { id: n.id, title: n.title, ...(n.parentId ? { parentId: n.parentId } : {}), ...(n.url ? { url: n.url } : {}), index: parent?.children?.indexOf(id) ?? 0 };
    if (n.children) b.children = deep ? n.children.map((c) => this.out(c, true)) : undefined;
    return b;
  }
  async getTree() { return [this.out('0', true)]; }
  async getSubTree(id: string) { return [this.out(id, true)]; }
  async get(id: string) { return [this.out(id, false)]; }
  async create(d: { parentId: string; title: string; url?: string; index?: number }) {
    const p = this.nodes.get(d.parentId);
    if (!p?.children) throw new Error('bad parent');
    if (d.url && this.rejectUrl?.(d.url)) throw new Error('Invalid URL.');
    const id = String(this.seq++);
    this.nodes.set(id, { id, parentId: d.parentId, title: d.title, ...(d.url ? { url: d.url } : { children: [] }) });
    p.children.splice(d.index ?? p.children.length, 0, id);
    return this.out(id, false);
  }
  async update(id: string, d: { title?: string; url?: string }) {
    const n = this.nodes.get(id)!;
    if (d.url && this.rejectUrl?.(d.url)) throw new Error('Invalid URL.');
    if (d.title !== undefined) n.title = d.title;
    if (d.url !== undefined) n.url = d.url;
    return this.out(id, false);
  }
  async move(id: string, d: { parentId: string; index?: number }) {
    const n = this.nodes.get(id)!;
    const old = this.nodes.get(n.parentId!)!;
    old.children = old.children!.filter((c) => c !== id);
    const p = this.nodes.get(d.parentId)!;
    p.children!.splice(d.index ?? p.children!.length, 0, id);
    n.parentId = d.parentId;
    return this.out(id, false);
  }
  async removeTree(id: string) {
    const n = this.nodes.get(id);
    if (!n) throw new Error('gone');
    for (const c of n.children ?? []) await this.removeTree(c);
    const p = this.nodes.get(n.parentId!)!;
    p.children = p.children!.filter((c) => c !== id);
    this.nodes.delete(id);
  }
  async remove(id: string) { return this.removeTree(id); }

  /* 테스트 도우미 */
  findFolder(title: string, under?: string) {
    for (const n of this.nodes.values()) if (!n.url && n.title === title && (!under || n.parentId === under)) return n.id;
    return undefined;
  }
  findUrl(url: string) {
    return [...this.nodes.values()].filter((n) => n.url === url).map((n) => n.id);
  }
  /** 루트 폴더 아래를 "경로 → 제목|url" 목록으로 */
  dump(rootId: string): string[] {
    const out: string[] = [];
    const walk = (id: string, path: string) => {
      for (const c of this.nodes.get(id)?.children ?? []) {
        const n = this.nodes.get(c)!;
        if (n.url) out.push(`${path}/${n.title}|${n.url}`);
        else {
          out.push(`${path}/${n.title}/`);
          walk(c, `${path}/${n.title}`);
        }
      }
    };
    walk(rootId, '');
    return out.sort();
  }
}

export class MemKV implements KV {
  v: EngineState | undefined;
  async get() { return this.v ? structuredClone(this.v) : undefined; }
  async set(s: EngineState) { this.v = structuredClone(s); }
}
