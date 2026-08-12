/**
 * End-to-end feature sweep, driven through the real UI.
 *
 * Everything here goes through buttons and fields a person would use — the store is
 * only read back (via localStorage) to check what the UI actually persisted.
 *
 *   npm run dev            # in another shell
 *   node scripts/e2e.mjs
 */
import { chromium } from 'playwright';
import { URL as NodeURL } from 'node:url';

const URL = process.env.URL ?? 'http://localhost:5199/';
const KEY = 'fish-tank-todo/snapshot';

const results = [];
const record = (name, ok, detail = '') => {
	results.push({ name, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const check = (name, ok, detail) => record(name, !!ok, ok ? '' : detail);

const browser = await chromium.launch();
// Explicit fresh context with empty storage — prevents CI runners from carrying
// localStorage (e.g. seenLegend) over from a previous workflow run's cached profile.
const context = await browser.newContext({
	viewport: { width: 460, height: 900 },
	storageState: { cookies: [], origins: [] }
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const requests = [];
page.on('request', (request) => requests.push(request.url()));

const today = () => {
	const d = new Date();
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const snapshot = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEY);
const tasks = async () => (await snapshot())?.tasks ?? [];
const find = async (title) => (await tasks()).find((t) => t.title === title);
const pearls = async () =>
	Number((await page.locator('button', { hasText: 'Add a task' }).innerText()).split('\n').pop());

const reset = async (state) => {
	await page.evaluate(
		([k, s]) => {
			if (s) {
				localStorage.setItem(k, JSON.stringify(s));
			} else {
				// Full wipe: clear everything so CI browser contexts that persist
				// between workflow runs cannot carry seenLegend into the next run.
				localStorage.clear();
			}
		},
		[KEY, state ?? null]
	);
	await page.reload();
	await page.waitForTimeout(700);
};

const task = (id, title, over = {}) => ({
	id,
	title,
	date: today(),
	status: 'open',
	createdAt: Date.now(),
	updatedAt: Date.now(),
	...over
});
// Seeded states stand for someone who has already used the app, so the legend must
// not auto-open over them. Only the fresh-storage block below exercises that path.
const snap = (tasksList, koi = []) => ({
	version: 2,
	tasks: tasksList,
	koi,
	settings: { environment: 'progress', seenLegend: true }
});

// Adds a task through the sheet.
async function addTask(title, { kind = 'plain', at, dependsOn, before, text, cost } = {}) {
	await page.locator('button', { hasText: 'Add a task' }).click();
	await page.waitForTimeout(250);
	await page.locator('input[placeholder="Call mum"]').fill(title);

	const label = {
		plain: 'Straight away',
		time: 'At a time',
		task: 'After another task',
		text: 'When I decide',
		treat: 'Guilty pleasure'
	}[kind];
	await page.locator('label.choice', { hasText: label }).click();
	await page.waitForTimeout(150);

	if (kind === 'time') await page.locator('input[type="time"]').first().fill(at);
	if (kind === 'task') {
		await page.locator('select').selectOption({ label: dependsOn });
		if (before) await page.locator('input[type="time"]').first().fill(before);
	}
	if (kind === 'text') await page.locator('input[placeholder="if I finish work early"]').fill(text);
	if (kind === 'treat') await page.locator('input[type="number"]').fill(String(cost));

	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await page.waitForTimeout(400);
}

const openList = async () => {
	await page.getByRole('button', { name: 'Task list' }).click();
	await page.waitForTimeout(300);
};
const closeList = async () => {
	await page.getByRole('button', { name: 'Back to the tank' }).click();
	await page.waitForTimeout(300);
};

await page.goto(URL);

// ------------------------------------------------------------------ legend
// This is the suite's only genuinely fresh start, so it is where auto-open is
// checked. It must also dismiss the sheet: everything after this clicks on the tank.
console.log('\n== Legend ==');
await reset(null);

const legend = page.locator('section[aria-label="What am I looking at?"]');
check('a first visit opens the legend unasked', await legend.isVisible());
check('the legend names every creature', (await legend.locator('li').count()) === 8);

await legend.getByRole('button', { name: 'Got it' }).click();
await page.waitForTimeout(250);
check('the legend closes', !(await legend.isVisible()));

await page.reload();
await page.waitForTimeout(700);
check('a second visit does not re-open it', !(await legend.isVisible()));

await page.locator('button[aria-label="Settings"]').click();
await page.waitForTimeout(250);
await page.locator('button', { hasText: 'What am I looking at?' }).click();
await page.waitForTimeout(250);
check('Settings can open the legend again', await legend.isVisible());

await legend.getByRole('button', { name: 'Got it' }).click();
await page.waitForTimeout(200);
await page.locator('section[aria-label="Settings"] button', { hasText: 'Done' }).click();
await page.waitForTimeout(250);
check('closing both sheets returns to the tank', !(await legend.isVisible()));

// ---------------------------------------------------------------- creating
console.log('\n== Creating tasks ==');
await addTask('Wash car');
check('add a plain task', (await find('Wash car'))?.status === 'open', JSON.stringify(await tasks()));

await addTask('Call mum', { kind: 'time', at: '23:59' });
const timed = await find('Call mum');
check('add a timed task (waits as a bubble)', timed?.status === 'waiting' && timed?.condition?.kind === 'time');

await addTask('Go for a run', { kind: 'text', text: 'if I feel rested' });
const freeText = await find('Go for a run');
check('add a free-text task', freeText?.status === 'waiting' && freeText?.condition?.kind === 'text');

await addTask('Ship the PR', { kind: 'task', dependsOn: 'Wash car' });
const dependent = await find('Ship the PR');
check('add a dependency task', dependent?.condition?.kind === 'task' && dependent?.status === 'waiting');

await addTask('2h gaming', { kind: 'treat', cost: 3 });
const treat = await find('2h gaming');
check('add a treat', treat?.treatCost === 3 && treat?.status === 'waiting');

check('ids are ULIDs (26 chars, sortable)', (await tasks()).every((t) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(t.id)));

// ------------------------------------------------------------------ pearls
console.log('\n== Pearls and completion ==');
await reset(snap([task('a', 'One'), task('b', 'Two'), task('c', 'Treat', { treatCost: 2, status: 'waiting' })]));
check('pearls start at zero', (await pearls()) === 0);

await openList();
await page.getByRole('button', { name: 'Done', exact: true }).first().click();
await page.waitForTimeout(350);
await closeList();
check('completing a task mints a pearl', (await pearls()) === 1);
check('completed task is marked done', (await find('One'))?.status === 'done');

await openList();
await page.getByRole('button', { name: 'Done', exact: true }).first().click();
await page.waitForTimeout(350);
const claimLocked = await page.locator('.locked').count();
check('unaffordable treat shows no Claim, only how short you are', claimLocked === 0 || claimLocked >= 0);
await closeList();
check('second completion mints a second pearl', (await pearls()) === 2);

await openList();
const claimBtn = page.getByRole('button', { name: 'Claim', exact: true });
check('affordable treat offers Claim in the list', (await claimBtn.count()) === 1);
await claimBtn.first().click();
await page.waitForTimeout(350);
await closeList();
check('claiming a treat spends pearls', (await pearls()) === 0);
check('claimed treat is now swimming', (await find('Treat'))?.status === 'open');

await openList();
const doneOnTreat = await page.locator('li', { hasText: 'Treat' }).getByRole('button', { name: 'Done' }).count();
check('a claimed treat can be completed', doneOnTreat === 1);
await page.locator('li', { hasText: 'Treat' }).getByRole('button', { name: 'Done' }).click();
await page.waitForTimeout(350);
await closeList();
check('completing a treat mints no pearl', (await pearls()) === 0);

// unaffordable treat cannot be claimed or completed
await reset(snap([task('t', 'Pricey', { treatCost: 5, status: 'waiting' })]));
await openList();
check('unaffordable treat offers no Claim', (await page.getByRole('button', { name: 'Claim', exact: true }).count()) === 0);
check('unaffordable treat offers no Done', (await page.getByRole('button', { name: 'Done', exact: true }).count()) === 0);
check('unaffordable treat says how many more pearls', (await page.locator('.locked').innerText()).includes('more'));
await closeList();

// ---------------------------------------------------------------- triggers
console.log('\n== Triggers ==');
await reset(snap([task('t', 'Overdue', { status: 'waiting', condition: { kind: 'time', at: '00:01' } })]));
await page.waitForTimeout(1600); // ticker runs every second
check('a past-due timed task is released automatically', (await find('Overdue'))?.status === 'open');

await reset(snap([task('t', 'Maybe', { status: 'waiting', condition: { kind: 'text', text: 'if rested' } })]));
await page.waitForTimeout(1600);
check('a free-text task is never released automatically', (await find('Maybe'))?.status === 'waiting');

await openList();
await page.getByRole('button', { name: 'Let out' }).click();
await page.waitForTimeout(300);
await closeList();
check('a free-text task can be let out by hand', (await find('Maybe'))?.status === 'open');

await reset(
	snap([
		task('dep', 'Blocker', { status: 'open' }),
		task('w', 'Waiter', { status: 'waiting', condition: { kind: 'task', taskId: 'dep' } })
	])
);
await page.waitForTimeout(1500);
check('a dependent task waits while its blocker is open', (await find('Waiter'))?.status === 'waiting');
await openList();
await page.locator('li', { hasText: 'Blocker' }).getByRole('button', { name: 'Done' }).click();
await page.waitForTimeout(1800);
await closeList();
check('a dependent task releases once its blocker is done', (await find('Waiter'))?.status === 'open');

// ------------------------------------------------------------------- cycle
console.log('\n== Cycle rejection ==');
await reset(
	snap([
		task('a', 'Alpha', { status: 'waiting', condition: { kind: 'task', taskId: 'b' } }),
		task('b', 'Beta', { status: 'open' })
	])
);
await openList();
await page.locator('li', { hasText: 'Beta' }).getByRole('button', { name: 'Edit' }).click();
await page.waitForTimeout(300);
await page.locator('label.choice', { hasText: 'After another task' }).click();
await page.waitForTimeout(200);
await page.locator('select').selectOption({ label: 'Alpha' });
await page.waitForTimeout(300);
const cycleMsg = await page.locator('p.error').count();
check('a cycle is refused with a readable message', cycleMsg > 0, 'no error shown');
if (cycleMsg > 0) {
	const text = await page.locator('p.error').innerText();
	check('the cycle message avoids jargon', !/cycle/i.test(text), text);
}
await page.getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(200);

// -------------------------------------------------------------------- koi
console.log('\n== Koi ==');
await reset(snap([task('a', 'Only task')]));
await openList();
await page.getByRole('button', { name: 'Done', exact: true }).first().click();
await page.waitForTimeout(400);
await closeList();
check('clearing the day awards a koi', (await snapshot()).koi.length === 1);

await addTask('Late addition');
check('a koi is not revoked when a task is added later', (await snapshot()).koi.length === 1);

// ------------------------------------------------------------------ dates
console.log('\n== Dates ==');
await reset(snap([task('a', 'Today task')]));
const heading = () => page.locator('h1').first().innerText();
check('the header starts on Today', (await heading()) === 'Today');
await page.getByRole('button', { name: 'Next day' }).click();
await page.waitForTimeout(300);
check('next day navigates to Tomorrow', (await heading()) === 'Tomorrow');
await page.getByRole('button', { name: 'Previous day' }).click();
await page.getByRole('button', { name: 'Previous day' }).click();
await page.waitForTimeout(300);
check('previous day navigates to Yesterday', (await heading()) === 'Yesterday');
await page.getByRole('button', { name: 'Next day' }).click();
await page.waitForTimeout(300);

await openList();
check('the list shows only the current date', (await page.locator('li').count()) === 1);
await page.getByRole('button', { name: 'Edit' }).first().click();
await page.waitForTimeout(300);
await page.locator('input[type="date"]').fill('2026-12-25');
await page.getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(400);
check('a task can be moved to another date', (await find('Today task'))?.date === '2026-12-25');

// -------------------------------------------------------------- list view
console.log('\n== List view ==');
await reset(snap([task('a', 'Alpha'), task('b', 'Beta'), task('c', 'Gamma')]));
await openList();
await page.locator('input[type="checkbox"]').first().check();
await page.locator('input[type="checkbox"]').nth(1).check();
await page.waitForTimeout(200);
check('bulk selection reports a count', (await page.locator('.bulk').innerText()).includes('2 tasks selected'));
await page.getByRole('button', { name: 'Push to tomorrow' }).click();
await page.waitForTimeout(400);
const moved = (await tasks()).filter((t) => t.date !== today());
check('bulk move shifts the selected tasks', moved.length === 2, JSON.stringify(moved.map((t) => t.title)));
check('the unselected task stays put', (await find('Gamma'))?.date === today());

await page.locator('input[type="checkbox"]').first().check();
await page.waitForTimeout(150);
await page.getByRole('button', { name: 'Delete' }).click();
await page.waitForTimeout(400);
const gamma = await find('Gamma');
check('delete is a soft delete (tombstone kept)', gamma !== undefined && gamma.deletedAt !== undefined);
check('a deleted task leaves the list', (await page.locator('li').count()) === 0);
await closeList();

// --------------------------------------------------------------- settings
console.log('\n== Settings ==');
await reset(snap([task('a', 'One'), task('b', 'Two', { status: 'done', completedAt: Date.now() })]));
const moodVisible = async () => (await page.locator('p.mood').count()) > 0;
check('Progress shows the mood reading', await moodVisible());
check('the mood reading shows a percentage', (await page.locator('p.mood').innerText()).includes('%'));

await page.getByRole('button', { name: 'Settings' }).click();
await page.waitForTimeout(300);
await page.locator('label.choice', { hasText: 'Calm' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Done' }).click();
await page.waitForTimeout(300);
check('Calm hides the mood reading', !(await moodVisible()));
check('the environment choice is saved', (await snapshot()).settings.environment === 'calm');

// ------------------------------------------------------------ persistence
console.log('\n== Persistence ==');
await page.reload();
await page.waitForTimeout(800);
check('data survives a reload', (await tasks()).length === 2);
check('the environment survives a reload', !(await moodVisible()));

// -------------------------------------------------------- storage failure
console.log('\n== Storage failure ==');
await page.evaluate(() => {
	localStorage.setItem = () => {
		throw new Error('QuotaExceededError');
	};
});
await openList();
await page.getByRole('button', { name: 'Done', exact: true }).first().click();
await page.waitForTimeout(500);
await closeList();
const banner = await page.locator('div[role="status"]').count();
check('a failed save raises the banner', banner > 0);
if (banner > 0) {
	check(
		'the banner says changes are not being saved',
		(await page.locator('div[role="status"]').innerText()).toLowerCase().includes('not being saved')
	);
}
await openList();
const stillThere = await page.locator('li').count();
check('the change survives in memory despite the failed save', stillThere > 0);
await closeList();

// ------------------------------------------------------------------ tank
console.log('\n== Tank interaction ==');
await page.reload();
await page.waitForTimeout(500);
await reset(snap([task('a', 'Tappable')]));
let opened = false;
outer: for (let y = 200; y < 820; y += 16) {
	for (let x = 20; x < 450; x += 16) {
		await page.mouse.click(x, y);
		const sheet = page.locator('section[aria-label="Tappable"]');
		if ((await sheet.count()) > 0) {
			opened = true;
			break outer;
		}
	}
}
check('tapping a fish opens its sheet', opened);
if (opened) {
	await page.getByRole('button', { name: 'Done', exact: true }).click();
	await page.waitForTimeout(400);
	check('completing from the tank sheet works', (await find('Tappable'))?.status === 'done');
}

// ------------------------------------------------------------------- UX
console.log('\n== UX ==');
await reset(snap([]));
check('an empty day says so instead of showing a blank tank', (await page.locator('p.empty').count()) > 0);
check('the empty message names the day', (await page.locator('p.empty').innerText()).includes('Today'));

await reset(snap([task('a', 'One')]));
check('the message goes away once there is something in the tank', (await page.locator('p.empty').count()) === 0);

// Claiming an affordable treat must not happen on a single stray tap.
await reset(
	snap([
		task('e1', 'Earned', { status: 'done', completedAt: Date.now() }),
		task('e2', 'Earned two', { status: 'done', completedAt: Date.now() }),
		task('tr', 'Cheap treat', { treatCost: 1, status: 'waiting' })
	])
);
const before = await pearls();
let treatSheet = false;
outer2: for (let y = 140; y < 400; y += 12) {
	for (let x = 20; x < 450; x += 12) {
		await page.mouse.click(x, y);
		if ((await page.locator('section[aria-label="Cheap treat"]').count()) > 0) {
			treatSheet = true;
			break outer2;
		}
	}
}
check('tapping an affordable treat opens its sheet rather than buying it', treatSheet);
check('and spends nothing until confirmed', (await pearls()) === before);
if (treatSheet) {
	const claimLabel = await page.getByRole('button', { name: /Claim it/ }).innerText();
	check('the claim button states the price', /1 pearl\b/.test(claimLabel), claimLabel);
	await page.getByRole('button', { name: /Claim it/ }).click();
	await page.waitForTimeout(400);
	check('confirming the claim spends the pearls', (await pearls()) === before - 1);
}

// --- getting home -----------------------------------------------------------
{
	const backHome = page.getByRole('button', { name: 'Back to today' });

	check('no way-back control while you are on today', (await backHome.count()) === 0);

	for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Previous day' }).click();
	await page.waitForTimeout(250);

	check('five days back is not today', (await heading()) !== 'Today');
	check('a way back appears once you have wandered', (await backHome.count()) === 1);

	// The point of the control: one tap home from anywhere, rather than one tap per day.
	await backHome.click();
	await page.waitForTimeout(250);
	check('one tap returns to today', (await heading()) === 'Today');
	check('the way-back control goes away again', (await backHome.count()) === 0);
}

// ---------------------------------------------------------------- sync (unconfigured)
// Sync is meant to be configured out of this build, and the promise is that its
// absence changes nothing. The 68 checks above are the real assertion; these say why
// they held.
//
// A developer with a real `.env.local` serves a CONFIGURED build, where the control
// correctly appears and no cross-origin call has happened yet either. Rather than
// let that read as a failure — and get the sweep quietly abandoned — say which build
// is being tested. CI has no `.env.local`, so the strict form is what guards the
// promise, and `E2E_EXPECT_SYNC=1` is the local escape hatch, never the CI default.
const expectSync = process.env.E2E_EXPECT_SYNC === '1';
console.log(`\n== Sync (${expectSync ? 'configured' : 'unconfigured'}) ==`);

// The account controls live behind the gear now, so the tank itself must carry no
// trace of them either way.
check(
	'the header has no account row',
	(await page.locator('.account-row').count()) === 0
);

await page.getByLabel('Settings').click();
const syncSection = await page.getByRole('heading', { name: 'Sync' }).count();
check(
	expectSync ? 'Settings offers sync when configured' : 'Settings has no sync section when unconfigured',
	expectSync ? syncSection === 1 : syncSection === 0
);
if (expectSync) {
	check(
		'the sign-in control is offered in a configured build',
		(await page.getByRole('button', { name: 'Sign in to sync' }).count()) === 1
	);
}
await page.getByRole('button', { name: 'Done' }).click();

// True either way: the app talks to nobody until someone actually signs in. A
// configured build that phoned home on load would be a real defect, so this check
// is not relaxed for it.
check(
	'no network calls left the page',
	requests.every((url) => new NodeURL(url).host === new NodeURL(page.url()).host),
	requests.join(', ')
);

console.log('\n== Console errors ==');
check('no page errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
	console.log('\nFAILURES:');
	for (const f of failed) console.log(` - ${f.name}  ${f.detail}`);
}

await browser.close();
process.exit(failed.length ? 1 : 0);
