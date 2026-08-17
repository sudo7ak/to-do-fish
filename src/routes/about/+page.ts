export const prerender = true;
// Unlike the rest of the app, this page has no localStorage access and exists
// specifically to be crawlable — SSR is on so it ships as real text, not an
// empty shell.
export const ssr = true;
