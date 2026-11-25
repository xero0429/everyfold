// 스토어 요약 = manifest description = _locales/<l>/messages.json 의 extDescription. Chrome Web Store 한도 132자.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname, '..', 'static', '_locales');
const read = (l: string) => JSON.parse(readFileSync(join(dir, l, 'messages.json'), 'utf8')) as Record<string, { message: string }>;

describe('_locales', () => {
  it('has en (default_locale) and ko', () => {
    expect(readdirSync(dir).sort()).toEqual(['en', 'ko']);
    expect(readFileSync(join(__dirname, '..', 'scripts', 'build.mjs'), 'utf8')).toMatch(/default_locale: 'en'/);
  });
  for (const l of ['en', 'ko']) {
    it(`${l}: extDescription ≤ 132 characters, same keys as en`, () => {
      const m = read(l);
      const d = m.extDescription?.message ?? '';
      expect(Object.keys(m).sort()).toEqual(Object.keys(read('en')).sort());
      expect([...d].length).toBeLessThanOrEqual(132);
      expect(d.trim()).not.toBe('');
    });
  }
});
