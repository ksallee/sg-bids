/**
 * The words around issuing a request and handing out its links. Pure, no I/O.
 *
 * Each link is shown once: only its hash is stored. The page offers Copy per vendor, Copy all, and an
 * Email button per vendor: a `mailto:` with the subject and the link in the body. The app sends no
 * email.
 */

/** The longest request name (`wire.MAX_REQUEST_NAME`). */
const MAX_NAME = 200;

export interface MailInput {
	readonly email: string;
	readonly vendor: string;
	readonly request: string;
	readonly project: string;
	/** The due day as the page shows it, or null when none is set. */
	readonly due: string | null;
	readonly link: string;
}

/** A `mailto:` to the vendor: the subject names the request, the body holds the link. */
export function mailtoHref(m: MailInput): string {
	const body = [
		`Hello ${m.vendor},`,
		'',
		`${m.project} asks you to bid on ${m.request}.${m.due ? ` Answers are due ${m.due}.` : ''}`,
		'',
		`Your link: ${m.link}`,
		'',
		`It opens your answer form. You need no account. The link is for ${m.vendor} alone: keep it private.`
	].join('\r\n');
	return `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(`Bid request: ${m.request}`)}&body=${encodeURIComponent(body)}`;
}

/** Every link at once, one vendor per line: its name, then its link. */
export function allLinks(links: readonly { readonly name: string; readonly link: string }[]): string {
	return links.map((l) => `${l.name}: ${l.link}`).join('\n');
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the issue sends, in one line. */
export function issueLine(bids: number, vendors: number): string {
	return `${plural(bids, 'bid')} ${bids === 1 ? 'goes' : 'go'} out to ${plural(vendors, 'vendor')}. ${vendors === 1 ? 'The vendor gets' : 'Each vendor gets'} one link.`;
}

/** The name a duplicate starts with: the request's, and ` copy`, cut to fit. */
export function copyName(name: string): string {
	const base = name.trim();
	return `${base.slice(0, MAX_NAME - ' copy'.length).trim()} copy`;
}
