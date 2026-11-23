import browser from 'webextension-polyfill';
import type { Msg } from './background.js';
import { friendlyError, hostOf, plural, relTime } from './popup-text.js';

/**
 * 팝업 — 화면 3개: 연결 전(connect) / 연결 후(main: 상태 카드 → 가져오기 → 정리 제안) / 설정(settings).
 * 백그라운드와는 Msg 로만 이야기한다(프로토콜은 그대로). 여기서는 그리기·문구만 다룬다.
 */
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
interface Suggestion { id: string; title: string; kind?: string; actions?: unknown[] }

let last: Status | null = null;
let view: 'main' | 'settings' = 'main';
let syncing = false;

const KIND_LABEL: Record<string, string> = { new_category: 'New category', apply_rules: 'Sort uncategorized', remove_empty: 'Remove empty' };

/* ───────── 그리기 ───────── */
function setBusy(el: HTMLElement, busy: boolean, label?: string) {
  el.setAttribute('aria-busy', String(busy));
  if (el instanceof HTMLButtonElement) el.disabled = busy;
  const l = el.querySelector('.btn-label');
  if (l && label) l.textContent = label;
}

function setError(raw: string | null | undefined) {
  const box = $('error');
  box.hidden = !raw;
  $('errorText').textContent = raw ? friendlyError(raw) : '';
  $('errorDetail').textContent = raw && friendlyError(raw) !== raw ? raw : '';
}

function badge(s: Status) {
  const [tone, icon, text] = syncing
    ? ['busy', 'i-spinner', 'Syncing…']
    : s.pendingMassDelete
      ? ['warn', 'i-pause', 'Paused']
      : s.lastError
        ? ['danger', 'i-error', 'Sync failed']
        : s.failedCount
          ? ['warn', 'i-alert', 'Synced with issues']
          : s.lastSyncAt
            ? ['ok', 'i-check', 'Up to date']
            : ['neutral', 'i-sync', 'Not synced yet'];
  $('syncBadge').dataset.tone = tone;
  $('syncBadgeIcon').setAttribute('href', `#${icon}`);
  $('syncBadgeText').textContent = text;
}

function renderLast(s: Status) {
  const t = $('last');
  if (s.lastSyncAt) {
    t.textContent = relTime(s.lastSyncAt);
    t.setAttribute('datetime', new Date(s.lastSyncAt).toISOString());
    t.title = new Date(s.lastSyncAt).toLocaleString();
  } else {
    t.textContent = 'never';
    t.removeAttribute('datetime');
    t.title = '';
  }
}

/** 오류 상자를 지금 보이는 화면의 맥락 자리로 옮긴다: 연결 폼은 Connect 버튼 바로 위, 그 밖은 화면 맨 위. */
function placeError() {
  const box = $('error');
  if (!last?.connected) $('connectForm').insertBefore(box, $('connectBtn'));
  else if (view === 'settings') $('settings').insertBefore(box, $('settings').children[1] ?? null);
  else $('main').prepend(box);
}

function setView(v: 'main' | 'settings', focus = false) {
  view = v;
  const connected = !!last?.connected;
  $('main').hidden = !connected || v !== 'main';
  $('settings').hidden = !connected || v !== 'settings';
  $('openSettings').hidden = !connected || v === 'settings';
  placeError();
  if (focus) (v === 'settings' ? $('settingsTitle') : $('openSettings')).focus();
}

function show(s: Status) {
  last = s;
  $('connect').hidden = s.connected;
  if (!s.connected) view = 'main';
  setView(view);

  const host = hostOf(s.serverUrl);
  for (const id of ['server', 'setServer']) {
    $(id).textContent = host;
    $(id).title = s.serverUrl ?? '';
  }
  for (const id of ['device', 'setDevice']) $(id).textContent = s.deviceName ?? '';
  renderLast(s);
  badge(s);
  setError(s.lastError);

  $('import').textContent = s.lastImport
    ? `First upload: ${s.lastImport.created} added, ${plural(s.lastImport.mergedExisting + s.lastImport.mergedInFile, 'duplicate')} merged`
    : '';

  $('failedBox').hidden = !s.failedCount;
  $('failedText').textContent = s.failedCount ? `${plural(s.failedCount, 'item')} couldn’t be written to this browser` : '';
  $('failedList').replaceChildren(...s.failed.map((f) => {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'f-title';
    title.textContent = f.title || f.url || '(untitled)';
    if (f.url) title.title = f.url;
    const why = document.createElement('span');
    why.className = 'caption';
    why.textContent = f.error;
    if (f.gaveUp) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Stopped retrying';
      why.append(tag);
    }
    li.append(title, why);
    return li;
  }));

  $<HTMLInputElement>('moveCaptures').checked = s.moveCaptures;
  $('moveHint').hidden = !s.showMoveHint;
  $('mass').hidden = !s.pendingMassDelete;
  if (s.pendingMassDelete) {
    const { deletes, live } = s.pendingMassDelete;
    $('massText').textContent = `${deletes} of ${plural(live, 'bookmark')} would be deleted. Was that on purpose?`;
    $('massConfirm').textContent = `Yes, delete ${deletes}`;
  }
}

async function refresh() {
  const st = await send<Status>({ type: 'status' });
  show(st);
  if (st.connected) await loadSuggestions();
}

async function act(m: Msg) {
  const r = await send<{ error?: string; status?: Status }>(m);
  if (r?.status) show(r.status);
  if (r?.error) setError(r.error);
  return r;
}

/** 버튼을 바쁨 표시한 채로 메시지를 보낸다(두 번 누르기 방지). */
async function busyAct(btn: HTMLElement, m: Msg, busyLabel?: string) {
  const label = btn.querySelector('.btn-label')?.textContent ?? undefined;
  setBusy(btn, true, busyLabel);
  try {
    return await act(m);
  } finally {
    setBusy(btn, false, label);
  }
}

function setResult(id: string, text: string, tone: 'ok' | 'danger' | '' = '') {
  const el = $(id);
  el.textContent = text;
  if (tone) el.dataset.tone = tone;
  else delete el.dataset.tone;
}

async function loadSuggestions(emptyText = '') {
  const r = await send<{ suggestions?: Suggestion[]; error?: string }>({ type: 'suggestions' });
  const list = r.suggestions ?? [];
  $('suggestions').replaceChildren(...list.map((s) => {
    const li = document.createElement('li');
    const text = document.createElement('div');
    text.className = 'sug-text';
    const title = document.createElement('span');
    title.className = 'sug-title';
    title.textContent = s.title;
    text.append(title);
    const meta = [s.kind ? KIND_LABEL[s.kind] : '', s.actions?.length ? plural(s.actions.length, 'change') : ''].filter(Boolean).join(' · ');
    if (meta) {
      const m = document.createElement('span');
      m.className = 'caption';
      m.textContent = meta;
      text.append(m);
    }
    const actions = document.createElement('div');
    actions.className = 'sug-actions';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn primary sm';
    ok.textContent = 'Apply';
    ok.setAttribute('aria-label', `Apply: ${s.title}`);
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'btn ghost sm';
    no.textContent = 'Dismiss';
    no.setAttribute('aria-label', `Dismiss: ${s.title}`);
    const decide = async (approve: boolean) => {
      ok.disabled = no.disabled = true;
      (approve ? ok : no).setAttribute('aria-busy', 'true');
      await act({ type: 'decide', id: s.id, approve });
      await loadSuggestions(approve ? 'Applied. You can undo it from the server.' : '');
    };
    ok.onclick = () => void decide(true);
    no.onclick = () => void decide(false);
    actions.append(ok, no);
    li.append(text, actions);
    return li;
  }));
  $('sugBox').hidden = !list.length;
  if (r.error) setResult('sugResult', friendlyError(r.error), 'danger');
  else setResult('sugResult', list.length ? `${plural(list.length, 'suggestion')} to review` : emptyText, list.length ? '' : 'ok');
}

/* ───────── 연결 ───────── */
const TOKEN_HELP = {
  admin: 'Your server’s ADMIN_TOKEN. It’s used once to register this browser and isn’t stored.',
  device: 'A device token you created on the server for this browser.',
};
$<HTMLSelectElement>('tokenKind').addEventListener('change', (ev) => {
  $('tokenHelp').textContent = TOKEN_HELP[(ev.target as HTMLSelectElement).value as 'admin' | 'device'];
});
$('tokenReveal').onclick = () => {
  const input = $<HTMLInputElement>('token');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  const b = $('tokenReveal');
  b.setAttribute('aria-pressed', String(show));
  b.setAttribute('aria-label', show ? 'Hide token' : 'Show token');
  b.title = show ? 'Hide token' : 'Show token';
};
$('connectForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const token = $<HTMLInputElement>('token').value.trim();
  const isDevice = $<HTMLInputElement>('tokenKind').value === 'device';
  setError(null);
  const r = await busyAct($('connectBtn'), {
    type: 'connect', serverUrl: $<HTMLInputElement>('serverUrl').value, deviceName: $<HTMLInputElement>('deviceName').value || 'browser',
    ...(isDevice ? { deviceToken: token } : { adminToken: token }),
  }, 'Connecting…');
  await refresh();
  // 연결 실패 오류는 status 에 남지 않으니 refresh 뒤에도 보이게 둔다
  if (r?.error && !last?.connected) setError(r.error);
});

/* ───────── 동기화 ───────── */
$('syncNow').onclick = async () => {
  syncing = true;
  if (last) badge(last);
  try {
    await busyAct($('syncNow'), { type: 'sync' }, 'Syncing…');
  } finally {
    syncing = false;
    if (last) badge(last);
  }
};
$('massConfirm').onclick = () => void busyAct($('massConfirm'), { type: 'confirmMassDelete' });
$('massRestore').onclick = () => void busyAct($('massRestore'), { type: 'restoreMassDelete' });
$('moveHintOn').onclick = () => void send<Status>({ type: 'setMoveCaptures', on: true }).then(show);
$('moveHintLater').onclick = () => void send<Status>({ type: 'dismissMoveHint' }).then(show);

/* ───────── 가져오기 ───────── */
$<HTMLInputElement>('importFile').addEventListener('change', async (ev) => {
  const input = ev.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  const row = $('importRow');
  row.setAttribute('aria-busy', 'true');
  setResult('importResult', `Importing ${f.name}…`);
  try {
    const r = await send<{ error?: string; received?: number; created?: number; mergedExisting?: number; mergedInFile?: number; skippedUnsafe?: number }>({ type: 'importFile', text: await f.text() });
    if (r.error) setResult('importResult', `Import failed: ${friendlyError(r.error)}`, 'danger');
    else {
      const dup = (r.mergedExisting ?? 0) + (r.mergedInFile ?? 0);
      setResult('importResult', `Imported ${r.received}: ${r.created} added, ${plural(dup, 'duplicate')} merged${r.skippedUnsafe ? `, ${r.skippedUnsafe} skipped (unsupported link type)` : ''}`, 'ok');
    }
  } finally {
    row.setAttribute('aria-busy', 'false');
    input.value = ''; // 같은 파일을 다시 고를 수 있게
  }
  await loadSuggestions();
});

/* ───────── 정리 제안 ───────── */
$('suggestNow').onclick = async () => {
  const btn = $('suggestNow');
  setBusy(btn, true);
  setResult('sugResult', 'Looking for cleanups…');
  try {
    const r = await send<{ error?: string }>({ type: 'generateSuggestions' });
    if (r?.error) setResult('sugResult', friendlyError(r.error), 'danger');
    else await loadSuggestions('Nothing to clean up right now.');
  } finally {
    setBusy(btn, false);
  }
};

/* ───────── 설정 ───────── */
$('openSettings').onclick = () => setView('settings', true);
$('closeSettings').onclick = () => setView('main', true);
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && view === 'settings' && last?.connected) {
    ev.preventDefault();
    setView('main', true);
  }
});
$<HTMLInputElement>('moveCaptures').addEventListener('change', (ev) => void send<Status>({ type: 'setMoveCaptures', on: (ev.target as HTMLInputElement).checked }).then(show));
const confirmBox = (open: boolean) => {
  $('disconnectConfirm').hidden = !open;
  $('disconnect').hidden = open;
  $('disconnect').setAttribute('aria-expanded', String(open));
  (open ? $('disconnectNo') : $('disconnect')).focus();
};
$('disconnect').onclick = () => confirmBox(true);
$('disconnectNo').onclick = () => confirmBox(false);
$('disconnectYes').onclick = async () => {
  await busyAct($('disconnectYes'), { type: 'disconnect' });
  $('disconnectConfirm').hidden = true;
  $('disconnect').hidden = false;
  $('disconnect').setAttribute('aria-expanded', 'false');
  // disconnect 는 Status 자체를 돌려준다
  await refresh();
  $('serverUrl').focus();
};

// 팝업을 열어 둔 동안 "4 minutes ago" 가 낡지 않게
setInterval(() => last && renderLast(last), 30_000);
void refresh();
