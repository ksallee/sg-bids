<!--
	How it works: the flow in five steps, with what each step keeps in the app and what it reads from
	or writes to Flow PT, side by side. Then what vendors see, and the site setup an admin does once.
	Copy only. The field list comes from `$lib/pure/fpt-fields`, so it stays the one the app creates.
-->
<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { BID_FIELDS, LINE_FIELDS, type FieldSpec, type FptDataType } from '$lib/pure/fpt-fields';
	import { cn } from '$lib/utils.js';

	interface Step {
		readonly title: string;
		readonly line: string;
		readonly app: string;
		readonly fpt: { readonly kind: 'read' | 'write' | 'none'; readonly text: string };
	}

	const steps: readonly Step[] = [
		{
			title: 'Build a request',
			line: 'Pick Shots and Assets in Flow PT. The request keeps a frozen copy of them. Later edits in Flow PT do not change it.',
			app: 'The request and its frozen copy.',
			fpt: { kind: 'read', text: 'Reads Shots, Assets and their fields.' }
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
			fpt: { kind: 'write', text: 'Writes Bids, Bid Lines, and Groups on the Shots and Assets won.' }
		}
	];

	const lands = [
		'One Bid per awarded vendor. With the switch "every line of every bid" on, one Bid per vendor that bid.',
		'One Bid Line per awarded Shot or Asset. With the switch on, one per line of every bid.',
		'The vendor’s Group, added to the vendor groups field (sg_vendor_groups) of each Shot and Asset it wins.'
	];

	const stays = ['The request and its frozen Shots and Assets.', 'The invitations.', 'Every bid with its lines, costs, rebates and versions.', 'The rates and the scenarios.', 'The award record.'];

	const vendorCan = [
		'Its own bid, in the app, through its link.',
		'The request as it was frozen.',
		'In Flow PT, with a login: the Shots and Assets its Group was given.'
	];

	const vendorCannot = ['Another vendor, or another vendor’s prices.', 'Any Flow PT id, in the app.', 'Bid and Bid Line in Flow PT, once an admin sets the Vendor role as below.'];

	const adminSteps = [
		'In Site Preferences, Entities, enable two custom entities. Display one as "Bid" and the other as "Bid Line", exactly. Give them no Tasks and no Versions.',
		'In the Vendor permission role, set See entities to Not allowed for Bid and for Bid Line. Consider Event Log Entry too.',
		'Check that the Vendor role sees a Shot and an Asset when the vendor groups field holds a Group the person is in.',
		'Open the publish page of a request as an Admin, and create the missing fields. The app creates them itself.'
	];

	const TYPE: Readonly<Record<FptDataType, string>> = {
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

	const reverse = [
		{ on: 'Group', name: 'Bid <-> Vendor', what: 'the Bids that name the Group' },
		{ on: 'Shot and Asset', name: 'Bid Line <-> Item', what: 'the Bid Lines on the Shot or Asset' },
		{ on: 'Bid', name: 'Bid Line <-> Bid', what: 'the lines of the Bid' }
	];

	const tables: readonly { title: string; fields: readonly FieldSpec[] }[] = [
		{ title: 'On Bid', fields: BID_FIELDS },
		{ title: 'On Bid Line', fields: LINE_FIELDS }
	];

	const MARK: Record<Step['fpt']['kind'], string> = {
		read: 'border-info/50 bg-info/10',
		write: 'border-success/60 bg-success/10',
		none: 'border-dashed text-muted-foreground'
	};
	const VERB: Record<Step['fpt']['kind'], string> = { read: 'Reads', write: 'Writes', none: 'None' };
</script>

<svelte:head><title>How it works · SG Bids</title></svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="how">
	<article class="mx-auto flex w-full max-w-4xl flex-col gap-14 px-4 pt-10 pb-20 sm:px-6 sm:pt-14">
		<header class="flex max-w-2xl flex-col gap-3">
			<h1 class="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">How it works</h1>
			<p class="text-muted-foreground text-base text-pretty">
				Five steps. Four of them live in the app. Flow PT is read at the start and written once, at the award, from your own session.
			</p>
		</header>

		<section class="flex flex-col gap-4" aria-labelledby="flow">
			<h2 id="flow" class="text-lg font-semibold">The flow</h2>
			<div class="text-muted-foreground hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-6 px-1 text-xs font-medium md:grid" aria-hidden="true">
				<span>Step</span><span>Kept in the app</span><span>Flow PT</span>
			</div>
			<ol class="border-border flex flex-col border-t">
				{#each steps as step, i (step.title)}
					<li class="border-border grid gap-3 border-b py-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-6 md:px-1">
						<div class="flex gap-3">
							<span
								class="border-border text-muted-foreground mt-px flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums"
								aria-hidden="true">{i + 1}</span
							>
							<div class="flex min-w-0 flex-col gap-1">
								<h3 class="text-sm font-semibold">{step.title}</h3>
								<p class="text-muted-foreground text-sm text-pretty">{step.line}</p>
							</div>
						</div>
						<div class="flex flex-col gap-1 pl-9 text-sm md:pl-0">
							<span class="text-muted-foreground text-xs md:hidden">Kept in the app</span>
							<p class="bg-muted/50 rounded-md border px-3 py-2">{step.app}</p>
						</div>
						<div class="flex flex-col gap-1 pl-9 text-sm md:pl-0">
							<span class="text-muted-foreground text-xs md:hidden">Flow PT</span>
							<p class={cn('rounded-md border px-3 py-2', MARK[step.fpt.kind])}>
								<span class="sr-only">{VERB[step.fpt.kind]}: </span>{step.fpt.text}
							</p>
						</div>
					</li>
				{/each}
			</ol>
		</section>

		<section class="grid gap-10 md:grid-cols-2" aria-label="Where the data lives">
			<div class="flex flex-col gap-3">
				<h2 class="text-lg font-semibold">What lands in Flow PT</h2>
				<ul class="flex list-disc flex-col gap-2 pl-5 text-sm">
					{#each lands as line (line)}<li>{line}</li>{/each}
				</ul>
				<p class="text-muted-foreground text-sm">
					Nothing else on a Shot or an Asset changes. Undo takes back exactly what the app wrote. It removes the Groups it added and deletes the rows it created.
				</p>
			</div>
			<div class="flex flex-col gap-3">
				<h2 class="text-lg font-semibold">What stays in the app</h2>
				<ul class="flex list-disc flex-col gap-2 pl-5 text-sm">
					{#each stays as line (line)}<li>{line}</li>{/each}
				</ul>
				<p class="text-muted-foreground text-sm">The app keeps it in its own database. Only its server reads it.</p>
			</div>
		</section>

		<section class="flex flex-col gap-4" aria-labelledby="vendors">
			<h2 id="vendors" class="text-lg font-semibold">What vendors see</h2>
			<div class="grid gap-4 md:grid-cols-2">
				<div class="flex flex-col gap-2 rounded-lg border p-4">
					<h3 class="text-sm font-semibold">They can see</h3>
					<ul class="flex list-disc flex-col gap-1.5 pl-5 text-sm">
						{#each vendorCan as line (line)}<li>{line}</li>{/each}
					</ul>
				</div>
				<div class="flex flex-col gap-2 rounded-lg border p-4">
					<h3 class="text-sm font-semibold">They cannot see</h3>
					<ul class="flex list-disc flex-col gap-1.5 pl-5 text-sm">
						{#each vendorCannot as line (line)}<li>{line}</li>{/each}
					</ul>
				</div>
			</div>
			<div class="border-warning/60 bg-warning/10 flex max-w-3xl flex-col gap-2 rounded-lg border px-4 py-3 text-sm">
				<p class="font-medium">Bid and Bid Line must be hidden from the Vendor role.</p>
				<p>
					A custom entity has no condition by default. While the Vendor role can read Bid or Bid Line, a vendor with a Flow PT login reads every bid in the
					project: each vendor, each total, each shot’s price, who won. A see rule does not close it. Hidden rows still show through a filter on a link, a
					total grouped on a link, and the event log. The app checks the role before it publishes and warns you.
				</p>
			</div>
		</section>

		<section class="flex flex-col gap-6" aria-labelledby="setup">
			<div class="flex max-w-2xl flex-col gap-2">
				<h2 id="setup" class="text-lg font-semibold">Site setup, once</h2>
				<p class="text-muted-foreground text-sm">An admin does this in the Flow PT web interface. Permission rules cannot be set from the app.</p>
			</div>
			<ol class="flex max-w-3xl flex-col gap-3">
				{#each adminSteps as line, i (line)}
					<li class="flex gap-3 text-sm">
						<span
							class="border-border text-muted-foreground mt-px flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums"
							aria-hidden="true">{i + 1}</span
						>
						<span class="pt-0.5 text-pretty">{line}</span>
					</li>
				{/each}
			</ol>

			<div class="grid gap-6 md:grid-cols-2">
				{#each tables as table (table.title)}
					<div class="flex min-w-0 flex-col gap-2">
						<h3 class="text-sm font-semibold">{table.title}</h3>
						<table class="w-full text-sm">
							<thead class="text-muted-foreground text-left text-xs">
								<tr class="border-b"><th class="py-1.5 pr-3 font-medium">Field</th><th class="py-1.5 pr-3 font-medium">Name</th><th class="py-1.5 font-medium">Type</th></tr>
							</thead>
							<tbody>
								{#each table.fields as field (field.name)}
									<tr class="border-b last:border-b-0">
										<td class="py-1.5 pr-3">{field.display}{#if field.stock}<span class="text-muted-foreground"> (stock)</span>{/if}</td>
										<td class="py-1.5 pr-3 font-mono text-xs break-all">{field.name}</td>
										<td class="py-1.5">{TYPE[field.dataType]}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/each}
			</div>
			<p class="text-muted-foreground max-w-3xl text-sm">
				The name field and Status are on every custom entity already. The app creates the rest. Amounts are kept with two decimals and their currency code in a
				text field beside them.
			</p>

			<div class="flex max-w-3xl flex-col gap-2">
				<h3 class="text-sm font-semibold">Fields Flow PT adds by itself</h3>
				<p class="text-sm text-pretty">
					Each link field makes a field on the type it links to. Flow PT makes these. They cannot be avoided. Deleting one also retires the field it mirrors.
				</p>
				<ul class="flex flex-col gap-1.5 text-sm">
					{#each reverse as r (r.name)}
						<li><span class="font-medium">On {r.on}:</span> “{r.name}”, {r.what}.</li>
					{/each}
				</ul>
			</div>
		</section>

		<div class="flex flex-wrap gap-3">
			<Button href="/connect">Start</Button>
			<Button variant="outline" href="/">Home</Button>
		</div>
	</article>
</div>
