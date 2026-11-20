/**
 * Production's comparison actions, each with a verified tenant: the routes under
 * `src/routes/api/production/` (compare, rate, scenarios, scenario-*) are one line each over these.
 * Bodies are checked by `$lib/pure/compare-wire` before the data layer sees them.
 */

import { parseCompareRead, parseRate, parseScenario, parseScenarioRef } from '$lib/pure/compare-wire';
import { parseId } from '$lib/pure/wire';
import { createComparison, type ComparisonStore } from './comparison';
import { database } from './env';
import { StoreError } from './errors';
import type { VerifiedProduction } from './production';
import type { Body } from './production-route';

let store: ComparisonStore | null = null;
function comparison(): ComparisonStore {
	store ??= createComparison(database());
	return store;
}

function parsed<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
	if (!result.ok) throw new StoreError(422, result.message);
	return result.value;
}

export function compare(production: VerifiedProduction, body: Body) {
	const { requestId, bids } = parsed(parseCompareRead(body));
	return comparison().loadComparison(production, requestId, bids);
}

export async function setRate(production: VerifiedProduction, body: Body) {
	const { requestId, bidId, rate } = parsed(parseRate(body));
	return { rate: await comparison().setRate(production, requestId, bidId, rate) };
}

export async function listScenarios(production: VerifiedProduction, body: Body) {
	const requestId = parseId(body.requestId);
	if (!requestId) throw new StoreError(422, 'That is not a request id.');
	return { scenarios: await comparison().listScenarios(production, requestId) };
}

export async function saveScenario(production: VerifiedProduction, body: Body) {
	const { requestId, ...input } = parsed(parseScenario(body));
	return { scenario: await comparison().saveScenario(production, requestId, input) };
}

export async function renameScenario(production: VerifiedProduction, body: Body) {
	const { requestId, scenarioId, name } = parsed(parseScenarioRef(body, { name: true }));
	return { scenario: await comparison().renameScenario(production, requestId, scenarioId!, name) };
}

export async function deleteScenario(production: VerifiedProduction, body: Body) {
	const { requestId, scenarioId } = parsed(parseScenarioRef(body));
	await comparison().deleteScenario(production, requestId, scenarioId!);
	return { ok: true };
}

export async function chooseScenario(production: VerifiedProduction, body: Body) {
	const { requestId, scenarioId } = parsed(parseScenarioRef(body, { nullable: true }));
	return { scenarios: await comparison().chooseScenario(production, requestId, scenarioId) };
}
