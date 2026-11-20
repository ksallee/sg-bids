/**
 * The request builder's two views and its address. Pure, no I/O.
 *
 * The draft is one working page; the review is the last look before the issue. The URL carries the
 * stored id and the view, so a link or a reload opens the same thing. Links from before the one
 * page (`step=review`, `step=details`) still open the right view.
 */

import { isLocalId } from './persist';

export type BuilderView = 'edit' | 'review';

export function parseView(params: URLSearchParams, readOnly: boolean): BuilderView {
	if (readOnly) return 'review';
	return params.get('view') === 'review' || params.get('step') === 'review' ? 'review' : 'edit';
}

export function builderHref(id: string, view: BuilderView): string {
	const query = [isLocalId(id) ? '' : `id=${encodeURIComponent(id)}`, view === 'review' ? 'view=review' : ''].filter(Boolean).join('&');
	return query ? `/bids/new?${query}` : '/bids/new';
}
