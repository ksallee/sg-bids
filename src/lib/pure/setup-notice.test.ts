import { describe, expect, it } from 'vitest';
import { findEntities } from './fpt-setup';
import { setupNotice } from './setup-notice';

const custom = (name: string, displayName: string) => ({ name, displayName });

describe('the site setup notice', () => {
	it('is silent when Bid and Bid Line are both set up', () => {
		expect(setupNotice(findEntities([custom('CustomEntity14', 'Bid'), custom('CustomEntity15', 'Bid Line'), custom('Shot', 'Shot')]))).toBeNull();
	});

	it('says what is missing, that the award waits for it alone, and the step for an admin', () => {
		expect(setupNotice(findEntities([custom('CustomEntity14', 'Bid')]))).toEqual({
			title: 'Bid Line is not set up on this site.',
			lines: ['Everything up to the award works without it. Publishing the award to Flow PT needs it.'],
			step: "An admin enables a custom entity displayed 'Bid Line' in the site preferences, with no Tasks and no Versions."
		});
		expect(setupNotice(findEntities([]))).toEqual({
			title: 'Bid and Bid Line are not set up on this site.',
			lines: ['Everything up to the award works without them. Publishing the award to Flow PT needs them.'],
			step: "An admin enables two custom entities, one displayed 'Bid' and one displayed 'Bid Line', in the site preferences, with no Tasks and no Versions."
		});
	});

	it('names two entities that carry one name', () => {
		const notice = setupNotice(findEntities([custom('CustomEntity14', 'Bid'), custom('CustomEntity20', 'Bid'), custom('CustomEntity15', 'Bid Line')]));
		expect(notice).toEqual({
			title: 'Two entities are displayed Bid on this site.',
			lines: ['Everything up to the award works without one. Publishing the award to Flow PT needs one, and only one.'],
			step: "An admin renames or disables one of them in the site preferences, so one custom entity is displayed 'Bid'."
		});
	});

	it('names a missing one and a doubled one together', () => {
		const notice = setupNotice(findEntities([custom('CustomEntity14', 'Bid Line'), custom('CustomEntity15', 'Bid Line')]));
		expect(notice?.title).toBe('Bid is not set up on this site, and two entities are displayed Bid Line.');
		expect(notice?.step).toBe(
			"An admin enables a custom entity displayed 'Bid' in the site preferences, with no Tasks and no Versions. An admin renames or disables one of them in the site preferences, so one custom entity is displayed 'Bid Line'."
		);
	});
});
