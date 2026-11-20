/** A colour per vendor column, from the theme's chart tokens, the same in the grid and the summary. */
const TONES = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5', 'bg-primary'];

export function vendorTone(column: number): string {
	return TONES[column % TONES.length];
}
