/**
 * Production's bid in the editor: what it holds, and what goes to storage. Pure, no I/O.
 *
 * A bid is a named set of rows in a project, always editable. It is stored once it has a project and
 * a name or a row, so a bid left at once leaves nothing behind. A bid with rows and no name saves as
 * Untitled bid. No thumbnail is stored: Flow PT's image URLs are presigned and expire (081). A row
 * carries no package: the bid is the group.
 */

import type { ProjectPick } from './header';
import type { Id, RequestAsset, RequestShot } from './model';

export const MAX_BID_NAME = 120;
export const UNTITLED_BID = 'Untitled bid';

export interface BidEditorState {
	readonly id: Id;
	readonly project: ProjectPick | null;
	/** As typed. */
	readonly name: string;
	readonly shots: readonly RequestShot[];
	readonly assets: readonly RequestAsset[];
}

/** A name or a row: what makes a bid worth keeping. */
export function hasBidContent(state: Pick<BidEditorState, 'name' | 'shots' | 'assets'>): boolean {
	return state.name.trim() !== '' || state.shots.length + state.assets.length > 0;
}

export type BidSavable =
	| { readonly ok: true; readonly name: string; readonly shots: readonly RequestShot[]; readonly assets: readonly RequestAsset[] }
	| { readonly ok: false; readonly reason: string };

function storedShot({ thumbnail, package: pkg, ...rest }: RequestShot): RequestShot {
	void thumbnail;
	void pkg;
	return rest;
}

function storedAsset({ timesUsed, package: pkg, ...rest }: RequestAsset): RequestAsset {
	void timesUsed;
	void pkg;
	return rest;
}

export function bidSavable(state: BidEditorState): BidSavable {
	if (!state.project) return { ok: false, reason: 'Pick a project to save the bid.' };
	if (!hasBidContent(state)) return { ok: false, reason: 'Name the bid or add a row to save it.' };
	const name = state.name.trim() || UNTITLED_BID;
	if (name.length > MAX_BID_NAME) return { ok: false, reason: `A bid name is ${MAX_BID_NAME} characters at most.` };
	return { ok: true, name, shots: state.shots.map(storedShot), assets: state.assets.map(storedAsset) };
}

export interface BidSummary {
	/** Shots not omitted. */
	readonly shots: number;
	/** Assets not omitted. */
	readonly assets: number;
	readonly omitted: number;
	/** Frames of the shots in, those with a count. */
	readonly frames: number;
	readonly shotsWithoutFrames: number;
}

export function bidSummary(shots: readonly RequestShot[], assets: readonly RequestAsset[]): BidSummary {
	const live = shots.filter((s) => !s.omitted);
	return {
		shots: live.length,
		assets: assets.filter((a) => !a.omitted).length,
		omitted: shots.length - live.length + assets.filter((a) => a.omitted).length,
		frames: live.reduce((n, s) => n + (s.frames ?? 0), 0),
		shotsWithoutFrames: live.filter((s) => s.frames === undefined).length
	};
}
