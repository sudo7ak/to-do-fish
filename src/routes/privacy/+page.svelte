<script lang="ts">
	import { base } from '$app/paths';
</script>

<svelte:head>
	<title>Privacy Policy — Fish Tank To-Do</title>
	<meta name="description" content="Privacy policy for Fish Tank To-Do — what data is collected, by whom, and how it is used." />
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<header class="site-header">
		<a href="{base}/" class="back">← Back to the tank</a>
	</header>

	<main class="content">
		<h1>Privacy Policy</h1>
		<p class="updated">Last updated: 11 August 2026</p>

		<p>
			Fish Tank To-Do ("the app") is a personal productivity tool built and operated by a
			single developer. This policy explains what data is collected when you use the app,
			who processes it, and what your rights are.
		</p>

		<h2>1. What we collect and why</h2>

		<h3>1.1 Your tasks — stored locally and optionally synced</h3>
		<p>
			All tasks, settings, and koi records are stored in your browser's
			<code>localStorage</code>. The app works in full with no account and no network —
			your data stays on your device in that case and we have no access to it.
		</p>
		<p>
			If you sign in, your data is automatically synchronised to a Supabase database
			so it is available across your devices (see §1.3). Signing in is the act of
			enabling sync — there is no separate toggle.
		</p>

		<h3>1.2 Anonymous analytics — Umami</h3>
		<p>
			The app uses <a href="https://umami.is" target="_blank" rel="noopener noreferrer">Umami</a>
			to count page visits. Umami is cookieless and collects no personally identifiable
			information. It records only:
		</p>
		<ul>
			<li>That a page was viewed (no user identity, no fingerprint)</li>
			<li>Approximate country (derived from IP address, which is not stored)</li>
			<li>Browser type and screen size (aggregated)</li>
		</ul>
		<p>
			Umami is hosted by Umami Cloud. Their privacy policy is available at
			<a href="https://umami.is/privacy" target="_blank" rel="noopener noreferrer">umami.is/privacy</a>.
			Analytics are only loaded on the live site — never in development or during automated testing.
		</p>

		<h3>1.3 Sync — Supabase (optional)</h3>
		<p>
			If you choose to sign in, your tasks are synchronised to a
			<a href="https://supabase.com" target="_blank" rel="noopener noreferrer">Supabase</a>
			database so they are available across your devices. Signing in is entirely optional;
			the app works in full without an account.
		</p>
		<p>When sync is enabled, the following is stored server-side:</p>
		<ul>
			<li>Your email address (used for authentication only)</li>
			<li>Your task data (encrypted in transit via HTTPS)</li>
		</ul>
		<p>
			You can delete your account and all associated data at any time by contacting us
			(see §5). Supabase's privacy policy is available at
			<a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">supabase.com/privacy</a>.
		</p>

		<h2>2. Cookies</h2>
		<p>
			The app sets no cookies. Umami is cookieless. Supabase uses a session token
			stored in <code>localStorage</code> (not a cookie) when you are signed in.
		</p>

		<h2>3. Third-party services summary</h2>
		<table>
			<thead>
				<tr>
					<th>Service</th>
					<th>Purpose</th>
					<th>Data shared</th>
					<th>Cookies</th>
					<th>Optional</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td>Umami Cloud</td>
					<td>Anonymous analytics</td>
					<td>Approximate country, browser type</td>
					<td>No</td>
					<td>No (always active in production)</td>
				</tr>
				<tr>
					<td>Supabase</td>
					<td>Cross-device sync</td>
					<td>Email address, task data</td>
					<td>No (localStorage token)</td>
					<td>Yes — requires sign-in</td>
				</tr>

			</tbody>
		</table>

		<h2>4. Data retention</h2>
		<ul>
			<li><strong>localStorage data</strong> — kept until you clear your browser storage or uninstall the app.</li>
			<li><strong>Umami analytics</strong> — aggregated, no personal data retained.</li>
			<li><strong>Supabase sync data</strong> — retained until your account is deleted.</li>
		</ul>

		<h2>5. Your rights</h2>
		<p>
			Under UK GDPR and the Data Protection Act 2018 you have the right to access,
			correct, or delete any personal data held about you. For data held in Supabase
			(your email and task data), contact us and we will delete your account and all
			associated records within 30 days.
		</p>
		<p>
			For Umami data, refer to their privacy policy linked above — we do not have
			access to data they hold independently.
		</p>

		<h2>6. Children</h2>
		<p>
			The app is not directed at children under 13. We do not knowingly collect data
			from children.
		</p>

		<h2>7. Changes to this policy</h2>
		<p>
			If this policy changes materially, the "Last updated" date above will be revised.
			Continued use of the app after a change constitutes acceptance of the updated policy.
		</p>

		<h2>8. Contact</h2>
		<p>
			Questions about this policy or data deletion requests:
			open an issue at
			<a href="https://github.com/sudo7ak/to-do-fish/issues" target="_blank" rel="noopener noreferrer">github.com/sudo7ak/to-do-fish</a>.
		</p>
	</main>
</div>

<style>
	.page {
		min-height: 100dvh;
		background: #f5fcfd;
		color: #12303a;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
	}

	.site-header {
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid rgba(18, 48, 58, 0.08);
	}

	.back {
		color: #12303a;
		text-decoration: none;
		font-size: 0.9rem;
		opacity: 0.7;
		transition: opacity 0.12s;
	}

	.back:hover {
		opacity: 1;
	}

	.content {
		max-width: 42rem;
		margin: 0 auto;
		padding: 2.5rem 1.5rem 4rem;
	}

	h1 {
		margin: 0 0 0.3rem;
		font-size: 1.75rem;
		font-weight: 700;
		line-height: 1.2;
	}

	h2 {
		margin: 2.5rem 0 0.6rem;
		font-size: 1.1rem;
		font-weight: 600;
		border-bottom: 1px solid rgba(18, 48, 58, 0.1);
		padding-bottom: 0.35rem;
	}

	h3 {
		margin: 1.5rem 0 0.4rem;
		font-size: 0.98rem;
		font-weight: 600;
	}

	.updated {
		margin: 0 0 1.5rem;
		font-size: 0.82rem;
		opacity: 0.55;
	}

	p {
		margin: 0.6rem 0;
		font-size: 0.95rem;
		line-height: 1.7;
	}

	ul {
		margin: 0.5rem 0 0.75rem 1.25rem;
		padding: 0;
	}

	li {
		font-size: 0.95rem;
		line-height: 1.6;
		margin-bottom: 0.2rem;
	}

	a {
		color: #1a7a9a;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	a:hover {
		color: #12303a;
	}

	code {
		font-size: 0.88em;
		background: rgba(18, 48, 58, 0.07);
		padding: 0.1em 0.35em;
		border-radius: 0.3em;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
		margin: 0.75rem 0 1rem;
	}

	th {
		text-align: left;
		padding: 0.5rem 0.75rem;
		background: rgba(18, 48, 58, 0.06);
		font-weight: 600;
		border-bottom: 2px solid rgba(18, 48, 58, 0.12);
	}

	td {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid rgba(18, 48, 58, 0.07);
		vertical-align: top;
		line-height: 1.5;
	}

	tr:last-child td {
		border-bottom: 0;
	}

	@media (max-width: 36rem) {
		table,
		thead,
		tbody,
		tr,
		th,
		td {
			display: block;
		}

		thead {
			display: none;
		}

		td {
			padding: 0.3rem 0;
			border: 0;
		}

		td::before {
			display: inline;
			font-weight: 600;
			opacity: 0.6;
		}

		tr {
			border-bottom: 1px solid rgba(18, 48, 58, 0.1);
			padding: 0.75rem 0;
		}
	}
</style>
