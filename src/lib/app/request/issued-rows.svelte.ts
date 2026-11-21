/**
 * An issued request's rows, for Match to Flow PT on its page: a breakdown row with no Flow PT row
 * gets one through the one change the freeze allows (`sg_link_request_items`). Vendors see nothing
 * new. The rules are `$lib/pure/match`; this holds the rows and makes the calls.
 */

import { api } from '$lib/api';
import { liveContext } from '$lib/live';
import { rowsByCodes } from '$lib/io/reads';
import type { ItemKind } from '$lib/pure/field-map';
import { codesToFind, matchRows, type Match } from '$lib/pure/match';
import type { BidRequest, RequestAsset, RequestShot } from '$lib/pure/model';
import type { ItemLink } from '$lib/pure/wire';
import type { Matcher } from '$lib/app/builder/matcher';

export class IssuedRows implements Matcher {
	state = $state.raw<{ shots: readonly RequestShot[]; assets: readonly RequestAsset[] }>({ shots: [], assets: [] });
	readonly readOnly = true;

	constructor(
		private readonly projectId: number,
		private readonly requestId: string,
		request: BidRequest,
		private readonly onLinked: (request: BidRequest) => void
	) {
		this.state = { shots: request.shots, assets: request.assets };
	}

	async findMatches(kind: ItemKind): Promise<Match[]> {
		const items = kind === 'shot' ? this.state.shots : this.state.assets;
		const codes = codesToFind(items);
		if (codes.length === 0) return [];
		const rows = await rowsByCodes(liveContext().client, kind === 'shot' ? 'Shot' : 'Asset', this.projectId, codes);
		const candidates = rows.flatMap((r) => (typeof r.attributes?.code === 'string' ? [{ id: r.id, code: r.attributes.code }] : []));
		return matchRows(kind, items, candidates);
	}

	async link(_kind: ItemKind, links: ItemLink[]): Promise<void> {
		if (links.length === 0) return;
		const { request } = await api.linkItems(this.projectId, this.requestId, links);
		this.state = { shots: request.shots, assets: request.assets };
		this.onLinked(request);
	}
}
