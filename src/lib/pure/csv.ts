/**
 * The comparison grid and an award scenario as CSV, for a spreadsheet.
 *
 * RFC 4180: comma separated, CRLF between records, a field quoted when it holds a comma, a quote
 * or a line break, quotes doubled. Amounts are plain decimals with every minor digit (`1500.00`),
 * never formatted for a locale, so a spreadsheet reads them as numbers. A text field that a
 * spreadsheet would run as a formula (`=`, `+`, `-`, `@`, tab, carriage return first) gets a
 * leading apostrophe; a plain number does not.
 */

import type { Cell, Converted, Grid } from './compare';
import type { Group } from './grid-view';
import type { Id } from './model';
import { targetKey } from './model';
import { toDecimal, type Money } from './money';
import { percentOf } from './percent';
import { wholePackages, type Picks, type ScenarioSummary } from './scenario';

const NUMBER = /^-?\d+(\.\d+)?$/;
const FORMULA = /^[=+\-@\t\r]/;

export function csvField(value: string): string {
	const safe = !NUMBER.test(value) && FORMULA.test(value) ? `'${value}` : value;
	return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(records: readonly (readonly string[])[]): string {
	return records.map((record) => record.map(csvField).join(',')).join('\r\n') + '\r\n';
}

const amount = (m: Money | null | undefined) => (m ? toDecimal(m) : '');

/** Basis points as a percent with two decimals: 2550 is `25.50`. Empty for unknown or infinite. */
export function bpText(bp: number | null): string {
	if (bp === null || !Number.isFinite(bp)) return '';
	const sign = bp < 0 ? '-' : '';
	const abs = Math.abs(bp);
	return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function status(cell: Cell): string {
	if (cell.kind === 'excluded') return 'excluded';
	if (cell.kind === 'missing') return 'not bid';
	if (cell.kind === 'package') return "in the bid's figure";
	if (cell.kind === 'declined') return 'not bidding';
	if (cell.amount.base === null) return 'needs a rate';
	return cell.lowest ? 'lowest' : 'price';
}

/** Every row of the grid, group by group, a price in the bid and the base currency per vendor, then the totals. */
export function gridCsv(grid: Grid, groups: readonly Group[], names: readonly string[]): string {
	const base = grid.baseCurrency;
	const head = ['Group', 'Kind', 'Code', 'Description', 'Omitted'];
	grid.columns.forEach((column, i) => head.push(`${names[i]} (${column.currency})`, `${names[i]} (${base})`, `${names[i]} status`));
	head.push('Lowest vendor', 'Spread %');

	const records: string[][] = [head];
	for (const group of groups) {
		for (const row of group.rows) {
			const record = [group.label, row.target.kind, row.label, row.description ?? '', row.omitted ? 'yes' : ''];
			for (const cell of row.cells) {
				record.push(cell.kind === 'price' ? amount(cell.amount.bid) : '', cell.kind === 'price' ? amount(cell.amount.base) : '', status(cell));
			}
			record.push(row.lowestColumns.map((c) => names[c]).join('; '), bpText(row.rangeBp));
			records.push(record);
		}
	}
	// Each package as a unit: a vendor's one figure, or the sum of its row prices.
	for (const unit of grid.packages) {
		if (!unit.cells.some((c) => c.kind === 'package')) continue;
		const record = ['Bids', 'bid', unit.name, '', ''];
		for (const cell of unit.cells) {
			if (cell.kind === 'none') record.push('', '', 'not bid');
			else if (cell.kind === 'declined') record.push('', '', 'not bidding');
			else record.push(amount(cell.amount.bid), cell.amount.base ? amount(cell.amount.base) : '', cell.kind === 'package' ? 'one figure' : cell.complete ? 'rows summed' : 'rows summed, not all priced');
		}
		record.push(unit.lowestColumns.map((c) => names[c]).join('; '), bpText(unit.rangeBp));
		records.push(record);
	}

	const total = (label: string, pick: (i: number) => Converted | null, note?: (i: number) => string) => {
		const record = ['Totals', 'total', label, '', ''];
		grid.columns.forEach((column, i) => {
			const value = pick(i);
			record.push(amount(value?.bid), value ? (value.base ? amount(value.base) : 'needs a rate') : '', note?.(i) ?? '');
		});
		records.push([...record, '', '']);
	};
	total('Shots and assets', (i) => grid.totals[i].items);
	total('Non-shot costs', (i) => grid.totals[i].costs);
	total('Discount', (i) => grid.totals[i].discount);
	total('Tax', (i) => grid.totals[i].tax);
	total('Grand total', (i) => grid.totals[i].grand);
	const rebateNote = (i: number) => {
		const t = grid.totals[i];
		if (t.splits === 0) return 'no rebate';
		return t.labourDetailMissing ? 'estimate unknown: labour split unknown' : 'estimate';
	};
	const withRebate = (i: number, value: Converted | null) => (grid.totals[i].splits === 0 ? null : value);
	total('Estimated rebate', (i) => withRebate(i, grid.totals[i].rebate), rebateNote);
	total('After rebate', (i) => withRebate(i, grid.totals[i].afterRebate), rebateNote);

	const rates = ['Totals', 'rate', `Rate to ${base}`, '', ''];
	for (const column of grid.columns) {
		if (column.currency === base) rates.push('', '1', 'base currency');
		else if (column.rate) rates.push('', column.rate.rate, `locked ${column.rate.date}`);
		else rates.push('', '', 'needs a rate');
	}
	records.push([...rates, '', '']);
	return toCsv(records);
}

/** One record per share of a pick, unawarded rows marked, then each vendor's part and the totals. */
export function scenarioCsv(grid: Grid, name: string, picks: Picks, summary: ScenarioSummary, names: readonly string[]): string {
	const base = grid.baseCurrency;
	const columnOf = new Map<Id, number>(grid.columns.map((c, i) => [c.bidId, i]));
	const records: string[][] = [['Scenario', name], [], ['Kind', 'Code', 'Sequence', 'Vendor', 'Share %', 'Price', 'Currency', `Amount (${base})`, 'Note']];
	const invalid = new Set(summary.invalid.map(targetKey));
	const wholes = new Set(wholePackages(grid, picks).map((w) => `${w.bidId}|${w.package}`));
	for (const row of grid.rows) {
		if (row.omitted) continue;
		const key = targetKey(row.target);
		const shares = picks.get(key) ?? [];
		if (shares.length === 0 || invalid.has(key)) {
			records.push([row.target.kind, row.label, row.sequence ?? '', '', '', '', '', '', invalid.has(key) ? 'pick no longer fits' : 'unawarded']);
			continue;
		}
		for (const share of shares) {
			const column = columnOf.get(share.bidId)!;
			const cell = row.cells[column];
			if (cell.kind === 'package') {
				records.push([row.target.kind, row.label, row.sequence ?? '', names[column], share.percent, '', grid.columns[column].currency, '', "in the bid's figure"]);
				continue;
			}
			if (cell.kind !== 'price') continue;
			const part = cell.amount.base ? percentOf(cell.amount.base, share.percent) : null;
			records.push([
				row.target.kind,
				row.label,
				row.sequence ?? '',
				names[column],
				share.percent,
				amount(cell.amount.bid),
				grid.columns[column].currency,
				part ? amount(part) : 'needs a rate',
				shares.length > 1 ? 'split' : ''
			]);
		}
	}
	for (const unit of grid.packages) {
		unit.cells.forEach((cell, column) => {
			if (cell.kind !== 'package' || !wholes.has(`${grid.columns[column].bidId}|${unit.id}`)) return;
			records.push(['bid', unit.name, '', names[column], '100', amount(cell.amount.bid), grid.columns[column].currency, cell.amount.base ? amount(cell.amount.base) : 'needs a rate', 'one figure for the bid']);
		});
	}
	records.push([], ['Vendor', 'Rows', `Shots and assets (${base})`, `Non-shot costs (${base})`, 'Costs counted', `Total (${base})`, 'Share %']);
	for (const vendor of summary.vendors) {
		records.push([
			names[vendor.column],
			String(vendor.rows),
			vendor.lines ? amount(vendor.lines) : 'needs a rate',
			vendor.costs.base ? amount(vendor.costs.base) : 'needs a rate',
			vendor.costsIncluded ? 'yes' : 'no',
			vendor.total ? amount(vendor.total) : 'needs a rate',
			bpText(vendor.shareBp)
		]);
	}
	const known = (m: Money | null) => (m ? amount(m) : 'needs a rate');
	records.push(
		[],
		['Shots and assets', known(summary.lines)],
		['Non-shot costs counted', known(summary.costs)],
		['Total', known(summary.total)],
		['Rows awarded', `${summary.awarded} of ${summary.live}`],
		['Discount and tax', 'stay with each bid grand total']
	);
	return toCsv(records);
}
