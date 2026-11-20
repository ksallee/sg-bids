// The app reads everything from the browser: the session is in localStorage and the site is
// called from there (see `$lib/live`), so there is nothing for the server to render. The public
// pages under `(public)` render at build instead.
export const ssr = false;
