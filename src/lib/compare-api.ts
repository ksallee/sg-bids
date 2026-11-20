/**
 * The browser's calls to the comparison endpoints (`src/routes/api/production/compare` and the
 * rest). Same frame as `$lib/api`: the Flow PT claim goes with every call, the server takes the
 * tenant from it.
 */

import { call } from '$lib/api';
import type { Comparison, StoredRate, StoredScenario } from '$lib/server/comparison';
import type { ScenarioPick } from '$lib/pure/model';

export type { BidVersion, Comparison, StoredRate, StoredScenario } from '$lib/server/comparison';

export const compareApi = {
	load: (projectId: number, id: string, bids: string[] = []) => call<Comparison>('compare', projectId, { id, bids }),
	setRate: (projectId: number, requestId: string, bidId: string, rate: { rate: string; date: string } | null) =>
		call<{ rate: StoredRate | null }>('rate', projectId, { requestId, bidId, rate }),
	scenarios: (projectId: number, requestId: string) => call<{ scenarios: StoredScenario[] }>('scenarios', projectId, { requestId }),
	save: (projectId: number, requestId: string, scenario: { id?: string; name: string; picks: ScenarioPick[]; costsLeftOut: string[] }) =>
		call<{ scenario: StoredScenario }>('scenario-save', projectId, { requestId, ...scenario }),
	rename: (projectId: number, requestId: string, scenarioId: string, name: string) => call<{ scenario: StoredScenario }>('scenario-rename', projectId, { requestId, scenarioId, name }),
	remove: (projectId: number, requestId: string, scenarioId: string) => call<{ ok: true }>('scenario-delete', projectId, { requestId, scenarioId }),
	choose: (projectId: number, requestId: string, scenarioId: string | null) => call<{ scenarios: StoredScenario[] }>('scenario-choose', projectId, { requestId, scenarioId })
};
