import browser from 'webextension-polyfill';
import type { Msg } from './background.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = <T = any>(m: Msg) => browser.runtime.sendMessage(m) as Promise<T>;

interface Status {
  connected: boolean; serverUrl: string | null; deviceName: string | null; lastSyncAt: number | null; lastError: string | null;
  lastImport: { created: number; mergedExisting: number; mergedInFile: number } | null;
  pendingMassDelete: { deletes: number; live: number } | null;
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

async function loadSuggestions() {
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
$('syncNow').onclick = () => void act({ type: 'sync' });
$('massConfirm').onclick = () => void act({ type: 'confirmMassDelete' });
$('massRestore').onclick = () => void act({ type: 'restoreMassDelete' });
$('disconnect').onclick = () => void act({ type: 'disconnect' });
void refresh();
