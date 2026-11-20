-- sg-bids storage: bid requests, their items, invitations, bids, award scenarios, awards.
--
-- Every read and write goes through the SvelteKit server with the secret key (service_role). Row
-- level security is on for every table and no policy exists, so `anon` and `authenticated` read
-- and write nothing; their table and function grants are revoked as well.
--
-- Every row carries its tenant, `site_host` + `project_id`. A child's tenant is held to its
-- parent's by a composite foreign key, so a row can never sit under another tenant's parent.
-- Every row under an invitation carries `invitation_id` the same way.
--
-- Frozen in the database, not only in code:
--   - an issued request: its items, code, round, base currency and header. A change is a new round.
--   - a submitted bid and its lines. A change is a new version. The one move left is withdrawal.
--
-- Idempotent: safe to apply again on a database that already has it.

-- Tables.

create table if not exists public.bid_requests (
	id uuid primary key default gen_random_uuid(),
	site_host text not null check (site_host ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'),
	project_id bigint not null check (project_id > 0),
	code text not null check (length(code) between 1 and 200),
	round integer not null default 1 check (round >= 1),
	status text not null default 'draft' check (status in ('draft', 'issued', 'closed')),
	base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
	header jsonb not null default '{}' check (jsonb_typeof(header) = 'object'),
	due_on date,
	issued_at timestamptz,
	closed_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint bid_requests_issued_at check ((status = 'draft') = (issued_at is null)),
	constraint bid_requests_closed_at check ((status = 'closed') = (closed_at is not null)),
	constraint bid_requests_code_round unique (site_host, project_id, code, round),
	constraint bid_requests_tenant_key unique (id, site_host, project_id)
);

create index if not exists bid_requests_tenant on public.bid_requests (site_host, project_id);

create table if not exists public.request_items (
	id uuid primary key default gen_random_uuid(),
	request_id uuid not null,
	site_host text not null,
	project_id bigint not null,
	kind text not null check (kind in ('shot', 'asset')),
	key text not null check (length(key) between 1 and 200),
	code text not null,
	position integer not null default 0,
	fpt_type text,
	fpt_id bigint,
	fields jsonb not null default '{}' check (jsonb_typeof(fields) = 'object'),
	omitted boolean not null default false,
	constraint request_items_fpt check ((fpt_type is null) = (fpt_id is null)),
	constraint request_items_key unique (request_id, kind, key),
	constraint request_items_request foreign key (request_id, site_host, project_id)
		references public.bid_requests (id, site_host, project_id) on delete cascade
);

create table if not exists public.invitations (
	id uuid primary key default gen_random_uuid(),
	request_id uuid not null,
	site_host text not null,
	project_id bigint not null,
	vendor_name text not null check (length(vendor_name) between 1 and 200),
	vendor_group_id bigint check (vendor_group_id > 0),
	contact_email text not null check (contact_email ~ '^[^@\s]+@[^@\s]+$'),
	details jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
	-- SHA-256 of the link token, hex. The token itself is never stored.
	token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
	expires_at timestamptz not null,
	revoked_at timestamptz,
	last_opened_at timestamptz,
	created_at timestamptz not null default now(),
	constraint invitations_token_hash unique (token_hash),
	constraint invitations_tenant_key unique (id, request_id, site_host, project_id),
	constraint invitations_request foreign key (request_id, site_host, project_id)
		references public.bid_requests (id, site_host, project_id) on delete cascade
);

create index if not exists invitations_request on public.invitations (request_id);

create table if not exists public.bids (
	id uuid primary key default gen_random_uuid(),
	invitation_id uuid not null,
	request_id uuid not null,
	site_host text not null,
	project_id bigint not null,
	version integer not null default 1 check (version >= 1),
	status text not null default 'draft' check (status in ('draft', 'submitted', 'withdrawn')),
	currency text not null check (currency ~ '^[A-Z]{3}$'),
	-- To the request's base currency, as typed. Null when the bid is in the base currency.
	exchange_rate text check (exchange_rate ~ '^[0-9]+(\.[0-9]+)?$' and exchange_rate !~ '^0+(\.0+)?$'),
	exchange_rate_date date,
	header jsonb not null default '{}' check (jsonb_typeof(header) = 'object'),
	non_shot_costs jsonb not null default '[]' check (jsonb_typeof(non_shot_costs) = 'array'),
	rebate_splits jsonb not null default '[]' check (jsonb_typeof(rebate_splits) = 'array'),
	submitted_at timestamptz,
	withdrawn_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint bids_rate check ((exchange_rate is null) = (exchange_rate_date is null)),
	constraint bids_submitted_at check ((status = 'draft') = (submitted_at is null)),
	constraint bids_withdrawn_at check ((status = 'withdrawn') = (withdrawn_at is not null)),
	constraint bids_version unique (invitation_id, version),
	constraint bids_tenant_key unique (id, invitation_id, request_id, site_host, project_id),
	constraint bids_request_key unique (id, request_id),
	constraint bids_invitation foreign key (invitation_id, request_id, site_host, project_id)
		references public.invitations (id, request_id, site_host, project_id) on delete cascade
);

-- One draft per invitation at a time.
create unique index if not exists bids_one_draft on public.bids (invitation_id) where status = 'draft';
create index if not exists bids_request on public.bids (request_id);

create table if not exists public.bid_lines (
	id uuid primary key default gen_random_uuid(),
	bid_id uuid not null,
	invitation_id uuid not null,
	request_id uuid not null,
	site_host text not null,
	project_id bigint not null,
	item_kind text not null,
	item_key text not null,
	-- Minor units of the bid's currency, inside a safe JavaScript integer.
	total_minor bigint not null check (total_minor between -9007199254740991 and 9007199254740991),
	excluded boolean not null default false,
	detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
	constraint bid_lines_item unique (bid_id, item_kind, item_key),
	constraint bid_lines_request_key unique (id, request_id),
	constraint bid_lines_item_key unique (id, item_kind, item_key),
	constraint bid_lines_bid foreign key (bid_id, invitation_id, request_id, site_host, project_id)
		references public.bids (id, invitation_id, request_id, site_host, project_id) on delete cascade,
	constraint bid_lines_request_item foreign key (request_id, item_kind, item_key)
		references public.request_items (request_id, kind, key)
);

create index if not exists bid_lines_invitation on public.bid_lines (invitation_id);

create table if not exists public.award_scenarios (
	id uuid primary key default gen_random_uuid(),
	request_id uuid not null,
	site_host text not null,
	project_id bigint not null,
	name text not null check (length(name) between 1 and 200),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint award_scenarios_tenant_key unique (id, request_id, site_host, project_id),
	constraint award_scenarios_request foreign key (request_id, site_host, project_id)
		references public.bid_requests (id, site_host, project_id) on delete cascade
);

create table if not exists public.award_scenario_items (
	id uuid primary key default gen_random_uuid(),
	scenario_id uuid not null,
	request_id uuid not null,
	site_host text not null,
	project_id bigint not null,
	item_kind text not null,
	item_key text not null,
	bid_id uuid not null,
	share_percent text not null check (share_percent ~ '^[0-9]+(\.[0-9]+)?$'),
	position integer not null default 0,
	constraint award_scenario_items_share unique (scenario_id, item_kind, item_key, bid_id),
	constraint award_scenario_items_scenario foreign key (scenario_id, request_id, site_host, project_id)
		references public.award_scenarios (id, request_id, site_host, project_id) on delete cascade,
	constraint award_scenario_items_request_item foreign key (request_id, item_kind, item_key)
		references public.request_items (request_id, kind, key),
	constraint award_scenario_items_bid foreign key (bid_id, request_id)
		references public.bids (id, request_id)
);

create table if not exists public.awards (
	id uuid primary key default gen_random_uuid(),
	request_id uuid not null,
	site_host text not null,
	project_id bigint not null,
	item_kind text not null,
	item_key text not null,
	bid_line_id uuid not null,
	share_percent text not null check (
		case when share_percent ~ '^[0-9]+(\.[0-9]+)?$'
			then share_percent::numeric > 0 and share_percent::numeric <= 100
			else false
		end
	),
	awarded_at timestamptz not null default now(),
	written_to_fpt_at timestamptz,
	constraint awards_line unique (bid_line_id),
	constraint awards_request foreign key (request_id, site_host, project_id)
		references public.bid_requests (id, site_host, project_id) on delete cascade,
	constraint awards_request_item foreign key (request_id, item_kind, item_key)
		references public.request_items (request_id, kind, key),
	-- The line awarded is for this item, in this request.
	constraint awards_line_item foreign key (bid_line_id, item_kind, item_key)
		references public.bid_lines (id, item_kind, item_key),
	constraint awards_line_request foreign key (bid_line_id, request_id)
		references public.bid_lines (id, request_id)
);

-- Triggers.

create or replace function public.sg_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
	new.updated_at := now();
	return new;
end;
$$;

-- A draft request changes freely. Issued, it is frozen but for its due day and closing.
create or replace function public.sg_bid_requests_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
	if tg_op = 'DELETE' then
		if old.status <> 'draft' then
			raise exception 'An issued request cannot be deleted.' using errcode = 'P0001';
		end if;
		return old;
	end if;

	if tg_op = 'INSERT' then
		if new.status <> 'draft' then
			raise exception 'A request starts as a draft.' using errcode = 'P0001';
		end if;
		return new;
	end if;

	if new.id <> old.id or new.site_host <> old.site_host or new.project_id <> old.project_id then
		raise exception 'A request cannot move to another project.' using errcode = 'P0001';
	end if;

	if old.status = 'draft' then
		if new.status = 'closed' then
			raise exception 'A draft is issued before it is closed.' using errcode = 'P0001';
		end if;
		if new.status = 'issued' then
			if not exists (select 1 from public.request_items where request_id = old.id) then
				raise exception 'A request needs a shot or an asset to be issued.' using errcode = 'P0001';
			end if;
			new.issued_at := now();
		end if;
		return new;
	end if;

	if new.code <> old.code or new.round <> old.round or new.base_currency <> old.base_currency
		or new.header <> old.header or new.issued_at is distinct from old.issued_at
		or new.created_at <> old.created_at then
		raise exception 'An issued request is frozen. A change is a new round.' using errcode = 'P0001';
	end if;
	if new.status = 'draft' then
		raise exception 'An issued request cannot go back to draft.' using errcode = 'P0001';
	end if;
	if old.status = 'closed' and new.status <> 'closed' then
		raise exception 'A closed request stays closed.' using errcode = 'P0001';
	end if;
	if old.status = 'issued' and new.status = 'closed' then
		new.closed_at := now();
	elsif new.closed_at is distinct from old.closed_at then
		raise exception 'An issued request is frozen. A change is a new round.' using errcode = 'P0001';
	end if;
	return new;
end;
$$;

-- The items of a request change only while it is a draft.
create or replace function public.sg_request_items_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
	ids uuid[];
begin
	if tg_op = 'INSERT' then
		ids := array[new.request_id];
	elsif tg_op = 'UPDATE' then
		ids := array[old.request_id, new.request_id];
	else
		ids := array[old.request_id];
	end if;
	-- A cascade from a deleted draft finds no parent. An issued parent cannot be deleted.
	if exists (select 1 from public.bid_requests where id = any (ids) and status <> 'draft') then
		raise exception 'The items of an issued request are frozen. A change is a new round.' using errcode = 'P0001';
	end if;
	if tg_op = 'DELETE' then
		return old;
	end if;
	return new;
end;
$$;

-- A draft bid changes while its invitation is live and its request is issued. A submitted bid is
-- final: the one move left is to withdraw it.
create or replace function public.sg_bids_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
	live boolean;
	request_status text;
begin
	if tg_op = 'DELETE' then
		if old.status <> 'draft' then
			raise exception 'A submitted bid cannot be deleted.' using errcode = 'P0001';
		end if;
		return old;
	end if;

	if tg_op = 'UPDATE' and old.status <> 'draft' then
		if old.status = 'submitted' and new.status = 'withdrawn'
			and (to_jsonb(new) - array['status', 'withdrawn_at', 'updated_at'])
				= (to_jsonb(old) - array['status', 'withdrawn_at', 'updated_at']) then
			new.withdrawn_at := now();
			return new;
		end if;
		raise exception 'A submitted bid is final. A change is a new version.' using errcode = 'P0001';
	end if;

	if tg_op = 'UPDATE' and (new.id <> old.id or new.invitation_id <> old.invitation_id
		or new.request_id <> old.request_id or new.site_host <> old.site_host
		or new.project_id <> old.project_id or new.version <> old.version
		or new.created_at <> old.created_at) then
		raise exception 'A bid cannot move to another invitation or version.' using errcode = 'P0001';
	end if;

	select i.revoked_at is null and i.expires_at > now(), r.status
		into live, request_status
		from public.invitations i
		join public.bid_requests r on r.id = i.request_id
		where i.id = new.invitation_id;
	if live is not true then
		raise exception 'The invitation is revoked or expired.' using errcode = 'P0001';
	end if;
	if request_status <> 'issued' then
		raise exception 'The request is not open for bids.' using errcode = 'P0001';
	end if;

	if new.status = 'withdrawn' then
		raise exception 'Only a submitted bid can be withdrawn.' using errcode = 'P0001';
	end if;
	if new.status = 'submitted' then
		new.submitted_at := now();
	else
		new.submitted_at := null;
	end if;
	new.withdrawn_at := null;
	return new;
end;
$$;

-- The lines of a bid change only while it is a draft.
create or replace function public.sg_bid_lines_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
	ids uuid[];
begin
	if tg_op = 'INSERT' then
		ids := array[new.bid_id];
	elsif tg_op = 'UPDATE' then
		ids := array[old.bid_id, new.bid_id];
	else
		ids := array[old.bid_id];
	end if;
	-- A cascade from a deleted draft finds no parent. A submitted bid cannot be deleted.
	if exists (select 1 from public.bids where id = any (ids) and status <> 'draft') then
		raise exception 'The lines of a submitted bid are final. A change is a new version.' using errcode = 'P0001';
	end if;
	if tg_op = 'DELETE' then
		return old;
	end if;
	return new;
end;
$$;

create or replace trigger bid_requests_guard before insert or update or delete on public.bid_requests
	for each row execute function public.sg_bid_requests_guard();
create or replace trigger bid_requests_touch before update on public.bid_requests
	for each row execute function public.sg_touch_updated_at();
create or replace trigger request_items_guard before insert or update or delete on public.request_items
	for each row execute function public.sg_request_items_guard();
create or replace trigger bids_guard before insert or update or delete on public.bids
	for each row execute function public.sg_bids_guard();
create or replace trigger bids_touch before update on public.bids
	for each row execute function public.sg_touch_updated_at();
create or replace trigger bid_lines_guard before insert or update or delete on public.bid_lines
	for each row execute function public.sg_bid_lines_guard();
create or replace trigger award_scenarios_touch before update on public.award_scenarios
	for each row execute function public.sg_touch_updated_at();

-- Functions the server calls for writes that must land whole. Each takes the scope the server
-- derived from the verified caller and filters on it.

-- Replace a draft request's items, in order.
create or replace function public.sg_save_request_items(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_items jsonb
) returns setof public.request_items
language plpgsql set search_path = '' as $$
begin
	perform 1 from public.bid_requests
		where id = p_request_id and site_host = p_site_host and project_id = p_project_id and status = 'draft'
		for update;
	if not found then
		raise exception 'No draft request %.', p_request_id using errcode = 'P0002';
	end if;
	delete from public.request_items where request_id = p_request_id;
	insert into public.request_items (request_id, site_host, project_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted)
		select p_request_id, p_site_host, p_project_id,
			e.item ->> 'kind', e.item ->> 'key', e.item ->> 'code', (e.ord - 1)::integer,
			e.item ->> 'fpt_type', (e.item ->> 'fpt_id')::bigint,
			coalesce(e.item -> 'fields', '{}'::jsonb), coalesce((e.item ->> 'omitted')::boolean, false)
		from jsonb_array_elements(p_items) with ordinality as e(item, ord);
	return query select * from public.request_items where request_id = p_request_id order by position;
end;
$$;

-- Write the invitation's draft bid and its lines: update the draft there is, or open the next
-- version. Returns the bid's id.
create or replace function public.sg_save_bid_draft(
	p_invitation_id uuid, p_bid jsonb, p_lines jsonb
) returns uuid
language plpgsql set search_path = '' as $$
declare
	inv public.invitations;
	draft uuid;
begin
	select * into inv from public.invitations where id = p_invitation_id for update;
	if not found then
		raise exception 'No invitation %.', p_invitation_id using errcode = 'P0002';
	end if;
	select id into draft from public.bids where invitation_id = inv.id and status = 'draft' for update;
	if draft is null then
		insert into public.bids (invitation_id, request_id, site_host, project_id, version, status, currency,
			exchange_rate, exchange_rate_date, header, non_shot_costs, rebate_splits)
		values (inv.id, inv.request_id, inv.site_host, inv.project_id,
			(select coalesce(max(version), 0) + 1 from public.bids where invitation_id = inv.id),
			'draft', p_bid ->> 'currency', p_bid ->> 'exchange_rate', (p_bid ->> 'exchange_rate_date')::date,
			coalesce(p_bid -> 'header', '{}'::jsonb), coalesce(p_bid -> 'non_shot_costs', '[]'::jsonb),
			coalesce(p_bid -> 'rebate_splits', '[]'::jsonb))
		returning id into draft;
	else
		update public.bids set
			currency = p_bid ->> 'currency',
			exchange_rate = p_bid ->> 'exchange_rate',
			exchange_rate_date = (p_bid ->> 'exchange_rate_date')::date,
			header = coalesce(p_bid -> 'header', '{}'::jsonb),
			non_shot_costs = coalesce(p_bid -> 'non_shot_costs', '[]'::jsonb),
			rebate_splits = coalesce(p_bid -> 'rebate_splits', '[]'::jsonb)
		where id = draft;
		delete from public.bid_lines where bid_id = draft;
	end if;
	insert into public.bid_lines (bid_id, invitation_id, request_id, site_host, project_id, item_kind, item_key, total_minor, excluded, detail)
		select draft, inv.id, inv.request_id, inv.site_host, inv.project_id,
			l ->> 'item_kind', l ->> 'item_key', (l ->> 'total_minor')::bigint,
			coalesce((l ->> 'excluded')::boolean, false), coalesce(l -> 'detail', '{}'::jsonb)
		from jsonb_array_elements(p_lines) as l;
	return draft;
end;
$$;

-- Create or replace a scenario and its picks. Picks name submitted bids of the same request only.
create or replace function public.sg_save_scenario(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_scenario_id uuid, p_name text, p_items jsonb
) returns uuid
language plpgsql set search_path = '' as $$
declare
	scenario uuid;
begin
	perform 1 from public.bid_requests
		where id = p_request_id and site_host = p_site_host and project_id = p_project_id and status <> 'draft';
	if not found then
		raise exception 'No issued request %.', p_request_id using errcode = 'P0002';
	end if;
	if exists (
		select 1 from jsonb_array_elements(p_items) as e
		left join public.bids b on b.id = (e ->> 'bid_id')::uuid and b.request_id = p_request_id and b.status = 'submitted'
		where b.id is null
	) then
		raise exception 'A scenario picks only submitted bids of its request.' using errcode = 'P0001';
	end if;
	if p_scenario_id is null then
		insert into public.award_scenarios (request_id, site_host, project_id, name)
			values (p_request_id, p_site_host, p_project_id, p_name)
			returning id into scenario;
	else
		update public.award_scenarios set name = p_name
			where id = p_scenario_id and request_id = p_request_id and site_host = p_site_host and project_id = p_project_id
			returning id into scenario;
		if scenario is null then
			raise exception 'No scenario %.', p_scenario_id using errcode = 'P0002';
		end if;
		delete from public.award_scenario_items where scenario_id = scenario;
	end if;
	insert into public.award_scenario_items (scenario_id, request_id, site_host, project_id, item_kind, item_key, bid_id, share_percent, position)
		select scenario, p_request_id, p_site_host, p_project_id,
			e.item ->> 'item_kind', e.item ->> 'item_key', (e.item ->> 'bid_id')::uuid, e.item ->> 'share_percent', (e.ord - 1)::integer
		from jsonb_array_elements(p_items) with ordinality as e(item, ord);
	return scenario;
end;
$$;

-- Row level security on, no policies: the public keys reach nothing.

alter table public.bid_requests enable row level security;
alter table public.request_items enable row level security;
alter table public.invitations enable row level security;
alter table public.bids enable row level security;
alter table public.bid_lines enable row level security;
alter table public.award_scenarios enable row level security;
alter table public.award_scenario_items enable row level security;
alter table public.awards enable row level security;

revoke all on table
	public.bid_requests, public.request_items, public.invitations, public.bids, public.bid_lines,
	public.award_scenarios, public.award_scenario_items, public.awards
	from anon, authenticated;
grant select, insert, update, delete on table
	public.bid_requests, public.request_items, public.invitations, public.bids, public.bid_lines,
	public.award_scenarios, public.award_scenario_items, public.awards
	to service_role;

revoke all on function
	public.sg_touch_updated_at(), public.sg_bid_requests_guard(), public.sg_request_items_guard(),
	public.sg_bids_guard(), public.sg_bid_lines_guard(),
	public.sg_save_request_items(uuid, text, bigint, jsonb),
	public.sg_save_bid_draft(uuid, jsonb, jsonb),
	public.sg_save_scenario(uuid, text, bigint, uuid, text, jsonb)
	from public, anon, authenticated;
grant execute on function
	public.sg_save_request_items(uuid, text, bigint, jsonb),
	public.sg_save_bid_draft(uuid, jsonb, jsonb),
	public.sg_save_scenario(uuid, text, bigint, uuid, text, jsonb)
	to service_role;
