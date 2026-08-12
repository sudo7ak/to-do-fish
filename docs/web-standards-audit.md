# Web Standards Audit

Analysis as of 2026-08-11. Documents what is already in place and what remains missing
from a standard production web app. Read alongside `docs/pending.md` before acting.

---

## Already covered

| Item                       | Where                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| Analytics                  | Umami via `+layout.svelte` (prod-only, cookieless)                                |
| PWA manifest + icons       | `static/manifest.json`, `static/icon-192.png`, `static/icon-512.png`              |
| OG / Twitter Card meta     | `src/app.html`                                                                    |
| Canonical, robots, sitemap | `static/robots.txt`, `static/sitemap.xml`, `<link rel="canonical">` in `app.html` |
| 404 SPA redirect           | `static/404.html`                                                                 |
| Favicon + apple-touch-icon | `static/favicon.png`, `static/apple-touch-icon.png`                               |
| OG social image            | `static/og-image.png` (1200×630)                                                  |
| Auth                       | Supabase (optional — app works without it)                                        |
| Offline-first              | localStorage; static hosting means initial load works offline                     |
| Privacy policy             | `src/routes/privacy/+page.svelte` — linked from Settings footer                  |
| Cookie consent             | `src/lib/ui/CookieConsent.svelte` + `src/lib/persist/consent.ts` — shown on first list open, gates Carbon script |

---

## 1. Privacy & Legal 🔴

### ~~1.1 Privacy policy page~~ ✅ Done

`src/routes/privacy/+page.svelte` — covers localStorage, Umami, Supabase sync, UK
GDPR rights, and 30-day deletion commitment. Linked from the Settings sheet footer.
Committed `fe58401`.

### ~~1.2 Cookie / consent notice~~ ✅ Done

`CookieConsent.svelte` shown on the first list open. Consent stored in
`fish-tank-todo/cookie-consent` localStorage key (separate from the task snapshot).
Carbon Ads script is gated behind `consent === 'granted'` — it never fires on decline.
Decline is remembered; banner does not reappear.

### 1.3 Terms of use

Low priority while the app is a personal tool. Becomes necessary if: other users
can sign up, the app is monetised, or user-generated data is stored server-side.

---

## 2. Discoverability & SEO 🟡

### 2.1 Structured data (JSON-LD)

A `WebApplication` schema block in `app.html` helps Google surface the app name,
description, and category in rich results. One `<script type="application/ld+json">`
block, ~15 lines.

```json
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "Fish Tank To-Do",
  "url": "https://sudo7ak.github.io/to-do-fish/",
  "description": "A to-do app where every task is a fish.",
  "applicationCategory": "ProductivityApplication",
  "operatingSystem": "Any"
}
```

### 2.2 App store presence

The PWA manifest enables Chrome's install prompt and Edge's sidebar install, but there
is no listing in:

- **Microsoft Store** — PWABuilder (pwabuilder.com) can generate a submission package
  automatically from the manifest. Lowest-effort store listing.
- **Google Play** — via Trusted Web Activity (TWA). Moderate effort.
- **iOS App Store** — requires a native wrapper (Capacitor/Cordova). High effort.

---

## 3. Performance & Reliability 🟠

### 3.1 Service worker (cache-first)

The app works offline because it is static, but a network hiccup during the _first_
load drops the user on a blank page. A cache-first service worker fixes this and
enables the Android "Install app" banner (which requires a SW to appear).

SvelteKit does not generate a SW by default. Options:

- `@vite-pwa/sveltekit` plugin — generates a Workbox-based SW automatically.
- Hand-rolled SW in `static/sw.js` — simpler, no extra dependency.

Note: the SW cache must be versioned to match the build hash, or stale assets will
be served after a deploy. The existing `5.0 — Rolling the deploy back` note in
`pending.md` applies here too.

### 3.2 Content Security Policy (CSP)

GitHub Pages serves no custom headers, so a `<meta http-equiv="Content-Security-Policy">`
tag in `app.html` is the only option. A minimal policy:

```
default-src 'self';
script-src 'self' https://cloud.umami.is https://cdn.carbonads.com;
img-src 'self' https://cdn.carbonads.com data:;
connect-src 'self' https://*.supabase.co;
style-src 'self' 'unsafe-inline';
```

`'unsafe-inline'` for styles is required by SvelteKit's scoped CSS injection unless
nonces are added (complex with a static adapter).

### 3.3 Subresource integrity (SRI)

The Umami and Carbon scripts are loaded from third-party CDNs with no `integrity`
attribute. If either CDN is compromised, malicious code runs in the app with full
access to localStorage (all task data). Add `integrity="sha384-…"` hashes once the
script URLs are stable.

---

## 4. Shareability & Growth 🟠

### 4.1 App landing / marketing page

There is no marketing page. The app URL goes straight into the tank. Someone sent
the link sees an aquarium with no context. A dedicated landing page — with
screenshots, a one-line pitch, and a CTA — converts link-clicks to users.

Options:

- A separate static site (GitHub Pages, separate repo).
- A `/about` route within this app that SSR-renders (currently `ssr = false` globally;
  a separate layout could enable it for `/about` only).
- A `README`-driven GitHub profile page.

### 4.2 `navigator.share()` — native share sheet

`navigator.share()` drops into the iOS/Android native share sheet with one function
call. A "Share this app" button in the Settings sheet footer would cost ~5 lines:

```typescript
navigator.share({
  title: "Fish Tank To-Do",
  url: "https://sudo7ak.github.io/to-do-fish/",
});
```

Feature-detect before rendering the button — desktop Chrome does not support it.

### 4.3 Changelog / What's new

No public release notes exist. Users who return after a deploy have no signal that
anything changed. Options:

- A `CHANGELOG.md` in the repo (developer-facing).
- A "What's new" entry in the Legend or Settings sheet (user-facing).
- GitHub Releases (automatic from tags).

---

## 5. Accessibility 🟡

### 5.1 Skip-to-content link

Standard pattern: a visually hidden `<a href="#main-content">Skip to content</a>` as
the first element in `<body>`, visible on focus. The canvas tank is not keyboard-
navigable by design, but the List view is — a skip link lets keyboard users reach it
without tabbing through the chrome.

### 5.2 Colour contrast audit

The white empty-day message (`color: #fff`) sits on `#4FC3D9` teal. Estimated
contrast ratio: ~2.8:1 — below the WCAG AA threshold of 4.5:1 for normal text.
Not measured with a tool; needs a proper audit.

Affected: `.empty` in `+page.svelte`, any white text on the teal background.

### 5.3 `lang` completeness

`<html lang="en">` is set. No inline foreign-language content identified, so no
further `lang` attributes are needed currently.

---

## 6. Monetisation Infrastructure 🟡

### 6.1 Tip jar link

Discussed in `docs/ad-integration.md`. Not yet added. One anchor in the Settings
sheet footer — Ko-fi or Buy Me a Coffee — costs nothing and captures goodwill from
users who want to support the app before Carbon Ads is approved.

### 6.2 Carbon Ads approval

The integration is wired (`src/lib/ui/ListView.svelte`, branch `feature/carbon-integration`)
but the slug is `XXXXXXXX`. Apply at carbonads.net. Approval is manual and can take
weeks — apply early.

---

## 7. Error Monitoring 🟡

### 7.1 Client-side error tracking

Umami tracks page views and custom events, not JavaScript exceptions. Errors in the
wild — a failed `localStorage` write, a canvas crash, a Supabase auth edge case —
are invisible.

Options:

- **Sentry** — industry standard, generous free tier, ~4 KB script.
- **LogRocket** — session replay + errors, heavier.
- A minimal `window.onerror` handler that POSTs to a Supabase table (no third-party
  dependency, data stays in the existing infrastructure).

The Supabase option fits the app's existing stack and keeps all data first-party.

---

## Priority summary

| Priority       | Item                                                   | Effort     |
| -------------- | ------------------------------------------------------ | ---------- |
| 🟠 Growth      | 4.1 App landing / marketing page                       | Medium     |
| 🟠 Performance | 3.1 Service worker (cache-first)                       | Medium     |
| 🟡 Growth      | 4.2 `navigator.share()` in Settings                    | Very low   |
| 🟡 SEO         | 2.1 JSON-LD structured data                            | Very low   |
| 🟡 Monitoring  | 7.1 Client-side error tracking                         | Low        |
| 🟡 Legal       | 1.3 Terms of use                                       | Low        |
| 🟡 SEO         | 2.2 App store presence (MS Store via PWABuilder first) | Low–Medium |
| 🟢 A11y        | 5.1 Skip-to-content link                               | Very low   |
| 🟢 A11y        | 5.2 Contrast audit                                     | Low        |
| 🟢 Growth      | 4.3 Changelog                                          | Low        |
| 🟢 Performance | 3.2 CSP meta tag                                       | Low        |
| 🟢 Performance | 3.3 Subresource integrity                              | Low        |
