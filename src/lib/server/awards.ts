/**
 * The award's record, beside `comparison.ts` and held to the same rules: every query carries the
 * principal's filter from `$lib/pure/access`, and every write is a SQL function in the verified
 * tenant (`20261122100000_award.sql`).
 *
 * The browser writes to Flow PT from production's own session and reads it back. Then it sends here
 * what Flow PT answered. The award rows and the summary are built from the chosen scenario as stored
 * and the bids it names, never from the body.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { scope, type ProductionPrincipal } from '$lib/pure/access';
import { awardRows, awardSummary, publicationFromRow, type AwardSummary, type Publication, type PublicationRow } from '$lib/pure/award-record';
import type { AwardRecordWire, AwardUndoWire } from '$lib/pure/award-wire';
import { createComparison, type ComparisonStore } from './comparison';
import { fromDatabase, StoreError } from './errors';
import type { VerifiedProduction } from './production';

async function run<T>(query: PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>): Promise<T> {
	const { data, error } = await query;
	if (error) throw fromDatabase(error);
	return data as T;
}

export function createAwards(db: SupabaseClient, comparison: ComparisonStore = createComparison(db)) {
	function tenant(principal: ProductionPrincipal) {
		return scope(principal, 'award_publications', 'read').eq as { site_host: string; project_id: number };
	}

	/** The request's award record, or null. */
	async function loadPublication(principal: ProductionPrincipal, requestId: string): Promise<Publication | null> {
		const given = scope(principal, 'award_publications', 'read');
		const row = await run<PublicationRow | null>(db.from('award_publications').select('*').match(given.eq).eq('request_id', requestId).maybeSingle());
		return row ? publicationFromRow(row) : null;
	}

	/** Record a run of the award: its rows from the chosen scenario, what Flow PT answered, who and when. */
	async function recordAward(principal: VerifiedProduction, input: AwardRecordWire): Promise<Publication> {
		const first = await comparison.loadComparison(principal, input.requestId);
		const scenario = first.scenarios.find((s) => s.id === input.scenarioId);
		if (!scenario) throw new StoreError(404, 'No such scenario.');
		if (!scenario.chosen) throw new StoreError(409, 'Publish the chosen scenario.');
		const asked = [...new Set(scenario.picks.flatMap((p) => p.shares.map((s) => s.bidId)))];
		const data = asked.length > 0 ? await comparison.loadComparison(principal, input.requestId, asked) : first;
		let rows: ReturnType<typeof awardRows> = [];
		let summary: AwardSummary;
		try {
			summary = awardSummary(data.request, data.bids, scenario);
			if (input.state === 'published') rows = awardRows(data.request, data.bids, scenario, input.written);
		} catch (error) {
			throw new StoreError(422, error instanceof Error ? error.message : String(error));
		}
		const t = tenant(principal);
		const exposure = input.exposure ? { ...input.exposure, acceptedAt: new Date().toISOString() } : null;
		await run(
			db.rpc('sg_record_award', {
				p_request_id: input.requestId,
				p_site_host: t.site_host,
				p_project_id: t.project_id,
				p_state: input.state,
				p_scenario_id: input.scenarioId,
				p_awards: rows,
				p_publication: {
					site: input.site,
					written: input.written,
					options: input.options,
					problems: input.problems,
					error: input.error,
					exposure,
					summary,
					published_by: { type: principal.user.type, id: principal.user.id, name: input.byName }
				}
			})
		);
		const stored = await loadPublication(principal, input.requestId);
		if (!stored) throw new StoreError(500, 'The award was not recorded.');
		return stored;
	}

	/** After an undo: clear the award when nothing is left in Flow PT, else keep what is. */
	async function clearAward(principal: ProductionPrincipal, input: AwardUndoWire): Promise<Publication | null> {
		const t = tenant(principal);
		await run(
			db.rpc('sg_clear_award', {
				p_request_id: input.requestId,
				p_site_host: t.site_host,
				p_project_id: t.project_id,
				p_remaining: input.remaining,
				p_error: input.error
			})
		);
		return loadPublication(principal, input.requestId);
	}

	return { loadPublication, recordAward, clearAward };
}

export type Awards = ReturnType<typeof createAwards>;
