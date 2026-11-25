// Chrome Web Store 소형 홍보 타일 440x280 PNG(로케일 없음 — 스토어가 타일은 언어별로 안 받는다).
// 실행: node scripts/promo-tile.mjs [출력 파일=../../docs/store/promo-tile-440x280.png]  — 헤드리스 Chromium, 창 없음.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, '..', '..', 'docs', 'store', 'promo-tile-440x280.png'));
const icon = readFileSync(join(root, 'assets', 'icon.svg'), 'utf8');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 440px; height: 280px; overflow: hidden; }
  body { display: flex; align-items: center; gap: 26px; padding: 0 36px; box-sizing: border-box;
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif; color: #fff;
    background: linear-gradient(135deg, #2742b6 0%, #3150d0 55%, #4a6cf0 100%); }
  .mark { flex: none; width: 124px; height: 124px; border-radius: 28px; background: #fff; display: grid; place-items: center;
    box-shadow: 0 10px 28px rgba(10, 20, 70, .35); }
  .mark svg { width: 96px; height: 96px; }
  h1 { margin: 0 0 10px; font-size: 40px; line-height: 1; font-weight: 750; letter-spacing: -0.02em; }
  p { margin: 0; font-size: 19px; line-height: 1.3; font-weight: 550; color: #edf1ff; }
</style></head><body>
  <div class="mark">${icon}</div>
  <div><h1>Everyfold</h1><p>One bookmark library<br>for every browser,<br>auto-organized.</p></div>
</body></html>`;

const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.screenshot({ path: out, type: 'png', omitBackground: false });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
