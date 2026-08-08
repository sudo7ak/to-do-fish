import { chromium } from 'playwright';

const OUT = process.argv[2] ?? 'tank.png';
const URL = 'http://localhost:5199/';

// A realistic day: several open tasks (one per species), a couple of waiting
// bubbles, some ghosts to mint pearls, and two treats on the waterline.
const seed = () => {
	const now = Date.now();
	const date = new Date();
	const pad = (n) => String(n).padStart(2, '0');
	const today = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

	const task = (id, title, over = {}) => ({
		id,
		title,
		date: today,
		status: 'open',
		createdAt: now,
		updatedAt: now,
		...over
	});

	const tasks = [
		task('t-aaa', 'Call mum'),
		task('t-bbb', 'Ship the PR'),
		task('t-ccc', 'Water the plants'),
		task('t-ddd', 'Read a chapter'),
		task('t-eee', 'Walk the dog'),
		task('t-fff', 'Reply to Sam'),
		task('t-ggg', 'Stretch', { status: 'waiting', condition: { kind: 'time', at: '18:00' } }),
		task('t-hhh', 'Go for a run', {
			status: 'waiting',
			condition: { kind: 'text', text: 'if I feel rested' }
		}),
		task('t-iii', 'Inbox zero', { status: 'done', completedAt: now }),
		task('t-jjj', 'Standup', { status: 'done', completedAt: now }),
		task('t-kkk', 'Invoices', { status: 'done', completedAt: now }),
		task('t-lll', 'Tidy desk', { status: 'done', completedAt: now }),
		task('t-mmm', '2h gaming', { status: 'waiting', treatCost: 3 }),
		task('t-nnn', 'Fancy coffee', { status: 'waiting', treatCost: 9 })
	];

	localStorage.setItem(
		'fish-tank-todo/snapshot',
		JSON.stringify({
			version: 1,
			tasks,
			koi: [{ date: '2026-08-01', earnedAt: now }],
			settings: { environment: 'calm' }
		})
	);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });

page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE ERROR:', m.text()));
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(URL);
await page.evaluate(seed);
await page.reload();
// Let the loop settle so the fish are mid-swim rather than all at phase zero.
await page.waitForTimeout(2500);

await page.screenshot({ path: OUT });
console.log('wrote', OUT);
await browser.close();
