/**
 * The details a draft's page saves. Pure, no I/O.
 *
 * A field that does not pass its check yet is left out of the save rather than stopping it, so a
 * half typed date never loses the rest: the page keeps it as typed and names the problem.
 */

import { isCurrency } from './currencies';
import { isDay, toHeader, type HeaderForm, type ProjectPick } from './header';
import type { RequestHeader } from './model';
import { isWebLink } from './safe-href';

/** The header a save sends: the form, each field that does not read yet left out. */
export function savableHeader(form: HeaderForm, project: ProjectPick): RequestHeader {
	return toHeader(
		{
			...form,
			baseCurrency: isCurrency(form.baseCurrency.trim()) ? form.baseCurrency.trim() : 'USD',
			dueDate: isDay(form.dueDate.trim()) ? form.dueDate : '',
			turnoverDate: isDay(form.turnoverDate.trim()) ? form.turnoverDate : '',
			deliveryDate: isDay(form.deliveryDate.trim()) ? form.deliveryDate : '',
			// The server takes only a web link (`wire.ts`); a half typed one would refuse the whole save.
			materialLink: isWebLink(form.materialLink.trim()) ? form.materialLink : ''
		},
		project
	);
}
