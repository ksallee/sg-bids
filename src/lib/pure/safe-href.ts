/**
 * Links someone typed (production's bid material) or a site answered, made safe to put in an
 * `href`. Only http and https pass: `javascript:`, `data:`, `file:` and the rest give nothing, so
 * the component renders text with no link. Pure, no I/O.
 *
 * The scheme is read from the text as typed, before the URL parser, which drops tabs and newlines
 * (`java\tscript:` would read as `javascript:`).
 */

const WEB = /^https?:\/\//i;

/** The link as the browser reads it, when it is http or https. Undefined for anything else. */
export function safeHref(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const text = value.trim();
	if (!WEB.test(text)) return undefined;
	try {
		const url = new URL(text);
		return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '' ? url.href : undefined;
	} catch {
		return undefined;
	}
}

/** Whether a typed link is an http or https address with no spaces: the header form and the server agree. */
export function isWebLink(text: string): boolean {
	return /^https?:\/\/\S+$/i.test(text) && safeHref(text) !== undefined;
}
