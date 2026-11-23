// 스크린샷 하네스 전용: webextension-polyfill 대신 번들된다. 백그라운드 없이 popup 을 상태별로 그리기 위한 가짜 runtime.
// 상태는 페이지에 미리 심은 window.__EF 에서 읽는다(scripts/screenshots.mjs 참조).
const ef = () => window.__EF;
const later = (v, ms = 0) => new Promise((r) => setTimeout(() => r(v), ms));
const never = () => new Promise(() => undefined);

async function sendMessage(m) {
  const s = ef();
  s.log.push(m.type);
  if (s.hang?.includes(m.type)) return never();
  if (s.responses?.[m.type]) return later(s.responses[m.type], 150);
  switch (m.type) {
    case 'status':
      return later(s.status);
    case 'sync':
    case 'confirmMassDelete':
    case 'restoreMassDelete':
      return later({ pushed: 0, pulled: 0, applied: 0, failed: 0, status: s.status }, 150);
    case 'suggestions':
      return later({ suggestions: s.suggestions ?? [] });
    case 'generateSuggestions':
      return later({ suggestions: s.suggestions ?? [] }, 150);
    case 'setMoveCaptures':
      s.status = { ...s.status, moveCaptures: m.on, showMoveHint: false };
      return later(s.status);
    case 'dismissMoveHint':
      s.status = { ...s.status, showMoveHint: false };
      return later(s.status);
    case 'connect':
      s.status = { ...s.status, connected: true, serverUrl: m.serverUrl, deviceName: m.deviceName, lastSyncAt: Date.now() };
      return later({ pushed: 0, pulled: 0, applied: 0, failed: 0, status: s.status }, 150);
    case 'disconnect':
      s.status = { ...s.status, connected: false };
      return later(s.status);
    default:
      return later({});
  }
}

export default { runtime: { sendMessage } };
