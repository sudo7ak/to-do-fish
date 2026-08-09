import { chromium } from 'playwright';

const URL = 'http://localhost:5199/';

const browser = await chromium.launch();
const page = await browser.newPage({
	viewport: { width: 460, height: 900 },
	deviceScaleFactor: 4
});
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE ERROR:', m.text()));

await page.goto(URL);
await page.evaluate(() => localStorage.removeItem('fish-tank-todo/snapshot'));
await page.reload();
await page.waitForTimeout(1200);

// The legend opens by itself here because storage was just cleared.
const sheet = await page.locator('section[aria-label="What am I looking at?"]').boundingBox();
if (!sheet) throw new Error('legend sheet not on screen');

await page.screenshot({ path: 'legend.png', clip: sheet });
console.log('wrote legend.png');
await browser.close();
