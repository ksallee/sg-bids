// The public pages: what sg-bids is, and how it works. Rendered at build into static HTML with
// their full text, so a crawler, a link preview or an AI reader gets the page without running it.
// The CSP of a prerendered page is a meta tag with hashes (`vite.config.ts`, `csp` mode `auto`);
// `vercel.json` sends the other security headers on these paths. Every page here is listed in
// `$lib/pure/seo` (`PUBLIC_PAGES`), and a test holds the two together.
export const ssr = true;
export const prerender = true;
