/**
 * Headless browser check for the Phase 1 game editor.
 * Usage: node scripts/verify_editor.mjs [baseUrl] [token]
 */
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('Playwright is not installed. Optional browser check skipped.');
  console.log('Install it with:  npm i -D playwright && npx playwright install chromium');
  process.exit(0);
}

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8756';
const token = process.argv[3] ?? process.env.VANTARA_ACCESS_TOKEN ?? '';

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
if (token) {
  await context.addCookies([{ name: 'vantara_access', value: token, domain: '127.0.0.1', path: '/' }]);
}
const page = await context.newPage();
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

await page.goto(`${baseUrl}/projects`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /New project/i }).first().click();
await page.getByLabel('Project name').fill('Playwright Arena');
await page.getByRole('button', { name: 'Create project' }).click();
await page.waitForURL(/\/editor\//, { timeout: 20000 });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(2500);

const canvasInfo = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return { present: false };
  const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
  return { present: true, width: canvas.width, height: canvas.height, webgl: Boolean(context) };
});

const outlinerBefore = await page.locator('text=Outliner').count();
await page.getByRole('button', { name: 'Sphere', exact: true }).first().click();
await page.waitForTimeout(1200);
const objectLabel = await page.locator('text=objects ·').first().textContent();
await page.screenshot({ path: '/tmp/vantara-editor.png', fullPage: false });

console.log(JSON.stringify({ canvas: canvasInfo, outlinerPresent: outlinerBefore > 0, objectLabel, errors }, null, 2));
await browser.close();
