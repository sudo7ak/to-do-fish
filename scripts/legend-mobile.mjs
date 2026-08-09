/**
 * Scratch: measure the legend sheet at phone widths. Not committed.
 *   npx vite dev --port 5199 &
 *   node scripts/legend-mobile.mjs
 */
import { chromium } from 'playwright';

const URL = 'http://localhost:5199/';
const SIZES = [
	{ name: 'iphone-se', w: 375, h: 667 },
	{ name: 'iphone-14', w: 390, h: 844 },
	{ name: 'pixel-7', w: 412, h: 915 },
	{ name: 'desktop', w: 1440, h: 900 }
];

const browser = await chromium.launch();

for (const size of SIZES) {
	const page = await browser.newPage({
		viewport: { width: size.w, height: size.h },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true
	});
	page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

	await page.goto(URL);
	await page.evaluate(() => localStorage.removeItem('fish-tank-todo/snapshot'));
	await page.reload();
	await page.waitForTimeout(1200);

	const sheet = page.locator('section[aria-label="What am I looking at?"]');
	const box = await sheet.boundingBox();

	const m = await page.evaluate(() => {
		const el = document.querySelector('section[aria-label="What am I looking at?"]');
		const btn = el?.querySelector('button');
		return {
			docScrollW: document.documentElement.scrollWidth,
			docClientW: document.documentElement.clientWidth,
			bodyScrollW: document.body.scrollWidth,
			innerW: window.innerWidth,
			innerH: window.innerHeight,
			sheetScrollH: el?.scrollHeight,
			sheetClientH: el?.clientHeight,
			sheetOverflows: el ? el.scrollHeight > el.clientHeight : null,
			btnText: btn?.textContent?.trim()
		};
	});

	console.log(`\n== ${size.name} ${size.w}x${size.h} ==`);
	console.log('sheet box:', box && { x: +box.x.toFixed(1), y: +box.y.toFixed(1), w: +box.width.toFixed(1), h: +box.height.toFixed(1) });
	console.log('viewport :', { innerW: m.innerW, innerH: m.innerH });
	console.log('h-overflow:', m.docScrollW > m.docClientW, `(scrollW ${m.docScrollW} vs clientW ${m.docClientW}, body ${m.bodyScrollW})`);
	console.log('sheet scrolls internally:', m.sheetOverflows, `(scrollH ${m.sheetScrollH} vs clientH ${m.sheetClientH})`);
	console.log('sheet covers % of viewport height:', box ? ((box.height / m.innerH) * 100).toFixed(0) + '%' : 'n/a');

	await page.screenshot({ path: `legend-${size.name}.png` });
	await page.close();
}

await browser.close();
console.log('\nwrote legend-<device>.png');
