import browser from 'webextension-polyfill';
import type { Msg } from './background.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = <T = any>(m: Msg) => browser.runtime.sendMessage(m) as Promise<T>;

interface Status {
  connected: boolean; serverUrl: string | null; deviceName: string | null; lastSyncAt: number | null; lastError: string | null;
  lastImport: { created: number; mergedExisting: number; mergedInFile: number } | null;
  pendingMassDelete: { deletes: number; live: number } | null;
  failed: Array<{ title: string; url: string | null; error: string; attempts: number; gaveUp: boolean }>;
  failedCount: number;
  moveCaptures: boolean;
  showMoveHint: boolean;
}

function show(s: Status) {
  $('connect').hidden = s.connected;
  $('main').hidden = !s.connected;
  $('server').textContent = s.serverUrl ?? '';
  $('device').textContent = s.deviceName ?? '';
  $('last').textContent = s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : 'never';
  $('error').textContent = s.lastError ?? '';
  $('import').textContent = s.lastImport
    ? `First upload: ${s.lastImport.created} added, ${s.lastImport.mergedExisting + s.lastImport.mergedInFile} duplicates merged`
    : '';
  $('failedBox').hidden = !s.failedCount;
  $('failedText').textContent = s.failedCount ? `${s.failedCount} item(s) could not be written to this browser — the rest synced normally.` : '';
  const ul = $('failedList');
  ul.replaceChildren(...s.failed.map((f) => {
    const li = document.createElement('li');
    li.textContent = `${f.title || f.url || '(untitled)'} — ${f.error}${f.gaveUp ? ' (stopped retrying)' : ''}`;
    return li;
  }));
  $<HTMLInputElement>('moveCaptures').checked = s.moveCaptures;
  $('moveHint').hidden = !s.showMoveHint;
  $('mass').hidden = !s.pendingMassDelete;
  if (s.pendingMassDelete) $('massText').textContent = `Sync paused: ${s.pendingMassDelete.deletes} of ${s.pendingMassDelete.live} bookmarks would be deleted.`;
}

async function refresh() {
  const st = await send<Status>({ type: 'status' });
  show(st);
  if (st.connected) await loadSuggestions();
}

async function act(m: Msg) {
  const r = await send<{ error?: string; status?: Status }>(m);
  if (r?.status) show(r.status);
  if (r?.error) $('error').textContent = r.error;
  return r;
}

async function loadSuggestions(emptyText = '') {
  const r = await send<{ suggestions?: Array<{ id: string; title: string }>; error?: string }>({ type: 'suggestions' });
  const ul = $('suggestions');
  ul.replaceChildren();
  for (const s of r.suggestions ?? []) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = s.title;
    const ok = document.createElement('button');
    ok.textContent = 'Apply';
    ok.onclick = async () => { await act({ type: 'decide', id: s.id, approve: true }); await loadSuggestions(); };
    const no = document.createElement('button');
    no.textContent = 'Dismiss';
    no.onclick = async () => { await act({ type: 'decide', id: s.id, approve: false }); await loadSuggestions(); };
    li.append(span, ok, no);
    ul.append(li);
  }
  $('sugBox').hidden = !(r.suggestions ?? []).length;
  $('sugResult').textContent = r.error ? r.error : (r.suggestions ?? []).length ? '' : emptyText;
}

$('connectForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const token = $<HTMLInputElement>('token').value.trim();
  const isDevice = $<HTMLInputElement>('tokenKind').value === 'device';
  await act({
    type: 'connect', serverUrl: $<HTMLInputElement>('serverUrl').value, deviceName: $<HTMLInputElement>('deviceName').value || 'browser',
    ...(isDevice ? { deviceToken: token } : { adminToken: token }),
  });
  await refresh();
});
$<HTMLInputElement>('importFile').addEventListener('change', async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  $('importResult').textContent = 'Importing…';
  const r = await send<{ error?: string; received?: number; created?: number; mergedExisting?: number; mergedInFile?: number; skippedUnsafe?: number }>({ type: 'importFile', text: await f.text() });
  $('importResult').textContent = r.error
    ? `Import failed: ${r.error}`
    : `Imported ${r.received}: ${r.created} added, ${(r.mergedExisting ?? 0) + (r.mergedInFile ?? 0)} duplicates merged${r.skippedUnsafe ? `, ${r.skippedUnsafe} skipped (unsupported link type)` : ''}`;
  await loadSuggestions();
});
$('suggestNow').onclick = async () => {
  $('sugResult').textContent = 'Looking for cleanups…';
  const r = await send<{ error?: string }>({ type: 'generateSuggestions' });
  if (r?.error) $('sugResult').textContent = r.error;
  else await loadSuggestions('Nothing to clean up right now.');
};
$<HTMLInputElement>('moveCaptures').addEventListener('change', (ev) => void send<Status>({ type: 'setMoveCaptures', on: (ev.target as HTMLInputElement).checked }).then(show));
$('moveHintOn').onclick = () => void send<Status>({ type: 'setMoveCaptures', on: true }).then(show);
$('moveHintLater').onclick = () => void send<Status>({ type: 'dismissMoveHint' }).then(show);
$('syncNow').onclick = () => void act({ type: 'sync' });
$('massConfirm').onclick = () => void act({ type: 'confirmMassDelete' });
$('massRestore').onclick = () => void act({ type: 'restoreMassDelete' });
$('disconnect').onclick = () => void act({ type: 'disconnect' });
void refresh();
