/**
 * The words of the public pages, Home and How it works, as data. The pages render from it, and so
 * do `/llms-full.txt` and the FAQ in the JSON-LD (`llms.ts`, `structured-data.ts`), so what an AI
 * reader quotes is what the page says. A test renders each page and checks every string is in it.
 *
 * Each question is a heading, and the answer right under it says it in two sentences. Every claim
 * is true of the app as built: the numbers come from the modules that hold them where they can.
 */

import { CURRENCIES } from './currencies';
import { BID_FIELDS, LINE_FIELDS, type FieldSpec, type FptDataType } from './fpt-fields';
import { REBATE_DEFAULTS } from './rebate-defaults';
import { REPO } from './seo';

export interface Link {
	readonly text: string;
	readonly href: string;
}

export interface Question {
	/** The heading's anchor. */
	readonly id: string;
	readonly q: string;
	/** The direct answer, two sentences. */
	readonly a: string;
	readonly list?: readonly string[];
	/** A closing line under the list. */
	readonly note?: string;
	readonly link?: Link;
}

export const DOCS = {
	deploy: { text: 'Deploy your own copy (docs/deploy.md)', href: `${REPO}/blob/main/docs/deploy.md` },
	development: { text: 'Working on sg-bids (docs/development.md)', href: `${REPO}/blob/main/docs/development.md` },
	dataModel: { text: 'The data model (docs/data-model.md)', href: `${REPO}/blob/main/docs/data-model.md` },
	repo: { text: 'The code on GitHub', href: REPO }
} as const satisfies Record<string, Link>;

/** Days a vendor link lasts when production sets no date. The store's `DEFAULT_INVITATION_DAYS`; a test holds them equal. */
export const LINK_DAYS = 60;

/** The places the rebate defaults cover, in the words a reader uses. A test checks one per default. */
export const REBATE_PLACES: Readonly<Record<string, string>> = {
	GB: 'the UK',
	CA: 'Canada',
	'CA-BC': 'British Columbia',
	'CA-QC': 'Quebec',
	'CA-ON': 'Ontario',
	AU: 'Australia',
	FR: 'France',
	NZ: 'New Zealand'
};

const places = REBATE_DEFAULTS.map((entry) => REBATE_PLACES[entry.code] ?? entry.label);
const placeList = `${places.slice(0, -1).join(', ')} and ${places.at(-1)}`;

export const HOME = {
	h1: 'VFX bidding for Flow Production Tracking.',
	lead: 'sg-bids is a free, open source web app that runs VFX bid rounds for Flow Production Tracking (formerly ShotGrid). Production builds a bid request from its Shots and Assets, or from a breakdown before they exist, vendors answer through a link, and the award is written back to Flow PT.',
	steps: [
		'Build a bid request from your Shots and Assets in Flow PT, or from a breakdown.',
		'Vendors answer through a link. They need no Flow PT account.',
		'Compare the bids shot by shot, in one currency.',
		'Award, and the award is written to Flow PT.'
	],
	questions: [
		{
			id: 'what',
			q: 'What is sg-bids?',
			a: 'A web app for the bid round of a VFX show. Production sends a request built from Flow PT, vendors bid through a link, and production compares the bids and awards them to Flow PT.',
			list: [
				'Bid requests from your Shots and Assets, or from a pasted breakdown, frozen when issued. A change is a new round.',
				'One link per vendor. The vendor needs no Flow PT account.',
				'Bids shot by shot, with costs, discount, tax and rebate splits, in versions.',
				'A comparison in one currency, award scenarios, and CSV exports.',
				'The award written to Flow PT after a preview of every write, with an undo.'
			]
		},
		{
			id: 'who',
			q: 'Who is it for?',
			a: 'VFX producers and production teams who run their shows in Flow PT and send shots to vendors. Vendors take part through their link, with no Flow PT account.',
			note: 'Production is a person in a permission group the deployment allows: Admin and Manager unless it names others.'
		},
		{
			id: 'free',
			q: 'Is it free?',
			a: 'Yes. sg-bids is open source under the MIT license, and the code is on GitHub.',
			note: 'Your own copy costs what its Vercel and Supabase plans cost. Vercel Hobby is for personal or non commercial use, so a studio uses Pro.',
			link: DOCS.repo
		},
		{
			id: 'host',
			q: 'How do I host my own copy?',
			a: 'Fork the repository and import it into a Vercel project with a Supabase database. Apply the SQL migrations, set the environment variables, and have an admin set up the Flow PT site once.',
			link: DOCS.deploy
		},
		{
			id: 'demo',
			q: 'Can I use this hosted copy for real bids?',
			a: 'No. It is a demo, and bids hold shot lists and prices, so a studio runs its own copy.'
		}
	] satisfies readonly Question[]
} as const;

export interface Step {
	readonly title: string;
	readonly line: string;
	readonly app: string;
	readonly fpt: { readonly kind: 'read' | 'write' | 'none'; readonly text: string };
}

export const HOW = {
	h1: 'How it works',
	lead: 'sg-bids runs a VFX bid round for Flow Production Tracking (formerly ShotGrid) in five steps. Four of them live in the app. Flow PT is written from your own session: when you edit a row of a draft in a column fed by Flow PT, when you create a field from the mapping, and at the award.',
	steps: {
		id: 'steps',
		q: 'What are the steps of a bid round?',
		a: 'Build a request, invite vendors, let them bid, compare, and publish the award. Flow PT is read in the first two steps, and written when you edit a draft’s row in a column fed by Flow PT and at the award.',
		items: [
			{
				title: 'Build a request',
				line: 'Pick Shots and Assets in Flow PT, or paste a breakdown when they are not in Flow PT yet. A draft shows the live values from Flow PT. Editing a row in a column fed by Flow PT changes Flow PT; the note to vendors, omit and breakdown rows stay in the request. Issuing freezes what you see.',
				app: 'The draft, and the frozen copy once it is issued.',
				fpt: { kind: 'write', text: 'Reads Shots, Assets and their fields. Writes a field of a Shot or Asset when you edit it in a draft, with Undo. Creates a field only when you ask, from the mapping.' }
			},
			{
				title: 'Invite vendors',
				line: 'Each vendor gets a link. Name its Flow PT Group if it has one. The award uses it.',
				app: 'The invitations. Only a hash of each link.',
				fpt: { kind: 'read', text: 'Reads Groups, to pick one.' }
			},
			{
				title: 'Vendors bid',
				line: 'A vendor opens its link and bids in its own currency. It needs no Flow PT account.',
				app: 'Each bid, its lines, costs, rebates and versions.',
				fpt: { kind: 'none', text: 'Nothing. Vendors never reach Flow PT through the app.' }
			},
			{
				title: 'Compare',
				line: 'See the bids shot by shot in one currency. Set a rate per bid. Build award scenarios and mark one as chosen.',
				app: 'The rates and the scenarios.',
				fpt: { kind: 'none', text: 'Nothing.' }
			},
			{
				title: 'Publish the award',
				line: 'Check the preview, then publish from your own Flow PT session. Undo it later if you need to.',
				app: 'The award: who won what, when, by whom, and what was written.',
				fpt: { kind: 'write', text: 'Writes Bids, Bid Lines, and Groups on the Shots and Assets won. Creates the Shots and Assets of a breakdown when you choose to.' }
			}
		] satisfies readonly Step[]
	},
	vendors: {
		id: 'vendors',
		q: 'How do vendors bid without a Flow PT account?',
		a: 'Each vendor gets its own link to the app. It opens the link and bids there in its own currency, and never reaches Flow PT through the app.',
		list: [
			'The link holds a random token. The app keeps only its hash.',
			`A link lasts ${LINK_DAYS} days unless production sets another date. Production can revoke it, or send a new link that replaces it. The bid is kept.`,
			'A vendor saves a draft, then submits it. It can withdraw a submitted bid or send a new version.',
			'A vendor can discard a draft. A new version it discards leaves the last submitted one in place.',
			'Prices can be pasted from a spreadsheet: a column of prices, or rows of code and price.'
		]
	} satisfies Question,
	written: {
		id: 'written',
		q: 'What gets written to Flow PT?',
		a: 'The award, from your own Flow PT session, after a preview of every write, and the fields an Admin creates for it from the publish page. While you build a request, an edit to a row in a column fed by Flow PT, and a field you create from the mapping.',
		list: [
			'While you build a request, the field of a Shot or Asset behind a column marked Live in Flow PT, when you edit it. Several selected rows change together after a confirm. Each edit offers Undo, which leaves a value someone changed in Flow PT since.',
			'One Bid per awarded vendor. With the switch "every line of every bid" on, one Bid per vendor that bid.',
			'One Bid Line per awarded Shot or Asset. With the switch on, one per line of every bid.',
			'The vendor’s Group, added to the vendor groups field (sg_vendor_groups) of each Shot and Asset it wins.',
			'For rows from a breakdown, the Shots and Assets you choose to create: the code, the description and the mapped fields that hold a value. Or none, and their Bid Lines carry no Shot or Asset.',
			'While you build a request, a field on Shot or Asset, when you create one from the mapping.'
		],
		note: 'Nothing else on a Shot or an Asset changes. Undo takes back exactly what the award wrote. It removes the Groups it added and deletes the rows it created, unless a Shot or Asset it created has since gained Tasks, Versions or other links. That one stays, and the app says so. A field created from the mapping stays.'
	} satisfies Question,
	stays: {
		id: 'stays',
		q: 'What stays in the app?',
		a: 'Everything else: the requests, the bids and the comparison. The app keeps it in its own database, and only its server reads it.',
		list: ['The request and its frozen Shots and Assets.', 'The invitations.', 'Every bid with its lines, costs, rebates and versions.', 'The rates and the scenarios.', 'The award record.'],
		note: 'Production can delete a request with all of it. A draft goes after one confirm. An issued request asks for its code first, and its vendors’ links then say the request was withdrawn. While the award is in Flow PT, undo it first. Deleting writes nothing to Flow PT and cannot be undone.'
	} satisfies Question,
	see: {
		id: 'see',
		q: 'What can vendors see?',
		a: 'A vendor sees its own bid and the request as it was frozen. It never sees another vendor, another vendor’s prices, or a Flow PT id.',
		can: ['Its own bid, in the app, through its link.', 'The request as it was frozen.', 'In Flow PT, with a login: the Shots and Assets its Group was given.'],
		cannot: ['Another vendor, or another vendor’s prices.', 'Any Flow PT id, in the app.', 'Bid and Bid Line in Flow PT, once an admin sets the Vendor role as below.'],
		warning: {
			title: 'Bid and Bid Line must be hidden from the Vendor role.',
			text: 'A custom entity has no condition by default. While the Vendor role can read Bid or Bid Line, a vendor with a Flow PT login reads every bid in the project: each vendor, each total, each shot’s price, who won. A see rule does not close it. Hidden rows still show through a filter on a link, a total grouped on a link, and the event log. The app checks the role before it publishes and warns you.'
		}
	},
	money: {
		id: 'money',
		q: 'Does it handle several currencies and tax rebates?',
		a: 'Yes. Each vendor bids in its own currency, and production compares every bid in the request’s base currency at a rate it sets per bid, with its date.',
		list: [
			`A request can be based in any of ${CURRENCIES.length} ISO 4217 currencies.`,
			'Amounts are whole minor units, never floating point. A bid without a rate shows in its own currency and says it needs one.',
			'The rate is locked once the request has an award.',
			'A bid can carry rebate splits by place: the share of the work, the rate, and the base (all of it, labour, or a percent of the contract).',
			`Default rates are filled in for ${places.length} places: ${placeList}. They can be changed per bid.`,
			'The comparison shows each bid’s rebate and its total after rebate. A rebate is always an estimate.'
		]
	} satisfies Question,
	admin: {
		id: 'admin',
		q: 'What must an admin set up?',
		a: 'An admin enables two custom entities, Bid and Bid Line, and hides them from the Vendor role. The app creates the fields it needs itself, from the publish page.',
		list: [
			'In Site Preferences, Entities, enable two custom entities. Display one as "Bid" and the other as "Bid Line", exactly. Give them no Tasks and no Versions.',
			'In the Vendor permission role, set See entities to Not allowed for Bid and for Bid Line. Consider Event Log Entry too.',
			'Check that the Vendor role sees a Shot and an Asset when the vendor groups field holds a Group the person is in.',
			'Open the publish page of a request as an Admin, and create the missing fields. The app creates them itself.'
		],
		note: 'An admin does this once, in the Flow PT web interface. Permission rules cannot be set from the app.',
		fieldsNote:
			'The name field and Status are on every custom entity already. The app creates the rest. Amounts are kept with two decimals and their currency code in a text field beside them.',
		reverseTitle: 'Fields Flow PT adds by itself',
		reverseLine: 'Each link field makes a field on the type it links to. Flow PT makes these. They cannot be avoided. Deleting one also retires the field it mirrors.',
		reverse: [
			{ on: 'Group', name: 'Bid <-> Vendor', what: 'the Bids that name the Group' },
			{ on: 'Shot and Asset', name: 'Bid Line <-> Item', what: 'the Bid Lines on the Shot or Asset' },
			{ on: 'Bid', name: 'Bid Line <-> Bid', what: 'the lines of the Bid' }
		]
	}
} as const;

/** The questions of a page that have a direct answer, in page order: the FAQ of the JSON-LD and of llms-full.txt. */
export const HOME_QUESTIONS: readonly Question[] = HOME.questions;
export const HOW_QUESTIONS: readonly Question[] = [HOW.steps, HOW.vendors, HOW.written, HOW.stays, HOW.see, HOW.money, HOW.admin];

/** A field type as the Flow PT interface names it. */
export const FIELD_TYPE: Readonly<Record<FptDataType, string>> = {
	text: 'Text',
	number: 'Number',
	float: 'Float',
	currency: 'Currency',
	date: 'Date',
	url: 'Link',
	checkbox: 'Checkbox',
	entity: 'Entity',
	status_list: 'Status'
};

/** The fields on the two custom entities, from `fpt-fields`, so the page lists the ones the app creates. */
export const FIELD_TABLES: readonly { readonly title: string; readonly fields: readonly FieldSpec[] }[] = [
	{ title: 'On Bid', fields: BID_FIELDS },
	{ title: 'On Bid Line', fields: LINE_FIELDS }
];
