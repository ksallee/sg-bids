/**
 * The site as the header names it: the studio, without the suffix every Flow PT host carries.
 * As sg-notes and sg-task-templates.
 */
export function shortHost(siteUrl: string): string {
	try {
		return new URL(siteUrl).hostname.replace(/^www\./, '').replace(/\.(?:shotgrid\.autodesk\.com|shotgunstudio\.com)$/, '');
	} catch {
		return siteUrl;
	}
}
