import { chromium } from 'playwright';

const URL = 'http://localhost:5199/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1000 }, deviceScaleFactor: 2 });

page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE ERROR:', m.text()));
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.emulateMedia({ reducedMotion: 'reduce' });
await page.goto(URL);
await page.evaluate(() => {
	const now = Date.now();
	const today = new Date().toISOString().slice(0, 10);
	const task = (id, title, over = {}) => ({
		id,
		title,
		date: today,
		status: 'open',
		createdAt: now,
		updatedAt: now,
		...over
	});
	localStorage.setItem(
		'fish-tank-todo/snapshot',
		JSON.stringify({
			version: 1,
			tasks: [
				task('t-a', 'Call mum'),
				task('t-b', 'Ship the PR'),
				task('t-c', 'Water the plants'),
				task('t-d', 'Fancy coffee', { status: 'waiting', treatCost: 3 })
			],
			koi: [{ date: '2026-08-01', earnedAt: now }],
			settings: { environment: 'calm', seenLegend: true }
		})
	);
});
await page.reload();
await page.waitForTimeout(300);

await page.screenshot({ path: 'desktop-wide.png' });
await browser.close();
console.log('wrote desktop-wide.png');
