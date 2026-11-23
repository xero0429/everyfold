import { describe, expect, it } from 'vitest';
import { API_VERSION, BLOCK_SERVER_BELOW, checkCompat, MIN_CLIENT_API, WARN_SERVER_BELOW } from '../src/version.js';

describe('server/extension compat', () => {
  const policy = { clientApi: 3, warnServerBelow: 3, blockServerBelow: 2 };
  it('current server and current extension are compatible', () => {
    expect(checkCompat({ api: API_VERSION, minClientApi: MIN_CLIENT_API })).toBe('ok');
    // 한 리포에서 나오는 짝은 서로 경고하지 않는다
    expect(API_VERSION).toBeGreaterThanOrEqual(WARN_SERVER_BELOW);
    expect(API_VERSION).toBeGreaterThanOrEqual(MIN_CLIENT_API);
    expect(BLOCK_SERVER_BELOW).toBeLessThanOrEqual(WARN_SERVER_BELOW);
  });
  it('older server → warn; much older → block; missing /version counts as api 0', () => {
    expect(checkCompat({ api: 2, minClientApi: 1 }, policy)).toBe('server_outdated');
    expect(checkCompat({ api: 1, minClientApi: 1 }, policy)).toBe('server_blocked');
    expect(checkCompat(null, policy)).toBe('server_blocked');
    expect(checkCompat(null, { ...policy, blockServerBelow: 0 })).toBe('server_outdated');
  });
  it('newer server that needs a newer extension → client_outdated', () => {
    expect(checkCompat({ api: 5, minClientApi: 4 }, policy)).toBe('client_outdated');
    expect(checkCompat({ api: 5, minClientApi: 3 }, policy)).toBe('ok');
  });
});
