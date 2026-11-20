/**
 * The page container rule, one place: a data page (a table, a grid) takes the full width inside
 * the shell's `px-6`; a page to read takes `wide`, a form `narrow`, both centred. The page header
 * and the page body of one screen take the same measure, so the title sits over the content.
 */
export type Measure = 'full' | 'wide' | 'narrow';

export const MEASURE: Record<Measure, string> = {
	full: '',
	wide: 'max-w-6xl',
	narrow: 'max-w-3xl'
};
