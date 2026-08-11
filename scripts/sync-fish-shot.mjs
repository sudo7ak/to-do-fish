import { chromium } from 'playwright';

// Screenshots the Legend row for the sync-status prototype fish, which is fixed at
// mood 'online'. Reaching 'offline'/'signed-out' through the running app needs a
// Supabase env local dev doesn't have, so this only proves the palette-override
// mechanism, not all three literal colour sets.
const URL = 'http://localhost:5199/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 6 });

page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE ERROR:', m.text()));
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.emulateMedia({ reducedMotion: 'reduce' });
await page.goto(URL);
await page.evaluate(() => {
	const now = Date.now();
	localStorage.setItem(
		'fish-tank-todo/snapshot',
		JSON.stringify({
			version: 1,
			tasks: [
				{ id: 't-a', title: 'Call mum', date: new Date().toISOString().slice(0, 10), status: 'open', createdAt: now, updatedAt: now }
			],
			koi: [],
			settings: { environment: 'calm', seenLegend: true }
		})
	);
});
await page.reload();
await page.waitForTimeout(300);

await page.screenshot({ path: 'legend-sync.png', clip: { x: 170, y: 290, width: 90, height: 90 } });
await browser.close();
console.log('wrote legend-sync.png');
