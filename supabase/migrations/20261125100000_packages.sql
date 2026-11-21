-- sg-bids packages: named groups of a request's rows, a vendor invited to some of them, and a
-- package priced as one figure.
--
--   - `request_packages`: a request's packages, in order. A key (`seq:SEQ010`, `shots`, `assets`,
--     `pkg:<random>`), a name unique in the request in any case, a position. Frozen with the request
--     at issue, as its items are.
--   - `request_items.package_key`: the row's package, held by a foreign key. A request with packages
--     has every row in one. A request from before packages has none, and the app reads it as one
--     package holding every row (`src/lib/pure/packages.ts`).
--   - `invitations.package_keys`: the packages the vendor is invited to. Null: every package. Only
--     keys of the request's own packages. It changes only while the vendor has no submitted or
--     withdrawn bid.
--   - `bids.packages`: the packages the vendor priced as one figure, `[{package, total, notes}]`, in
--     the model's shape. Frozen with a submitted bid: its guard compares the whole row.
--   - `bid_lines.in_package`: the row is covered by its package's figure. Its total is zero.
--   - The vendor's packages are a boundary in the database too: a line for a row outside them, or a
--     figure for a package outside them, is refused.
--   - `sg_save_request_items` takes the packages with the items, in one write. The call without them
--     clears the request's packages, so a request is never half packaged.
--   - `sg_delete_request` deletes the packages with the rest.
--
-- Additive: no existing row changes. Idempotent: safe to apply again.

create table if not exists public.request_packages (
	id uuid primary key default gen_random_uuid(),
	request_id uuid not null,
	site_host text not null,
	project_id bigint not null,
	key text not null check (length(key) between 1 and 200),
	name text not null check (length(name) between 1 and 120 and name = btrim(name)),
	position integer not null default 0,
	constraint request_packages_key unique (request_id, key),
	constraint request_packages_request foreign key (request_id, site_host, project_id)
		references public.bid_requests (id, site_host, project_id) on delete cascade
);

create unique index if not exists request_packages_name on public.request_packages (request_id, lower(name));

alter table public.request_items add column if not exists package_key text;
alter table public.invitations add column if not exists package_keys text[];
alter table public.bids add column if not exists packages jsonb not null default '[]';
alter table public.bid_lines add column if not exists in_package boolean not null default false;

do $$
begin
	if not exists (select 1 from pg_constraint where conname = 'request_items_package') then
		alter table public.request_items add constraint request_items_package foreign key (request_id, package_key)
			references public.request_packages (request_id, key);
	end if;
	if not exists (select 1 from pg_constraint where conname = 'invitations_package_keys') then
		alter table public.invitations add constraint invitations_package_keys check (
			package_keys is null or (cardinality(package_keys) between 1 and 500 and array_position(package_keys, null) is null)
		);
	end if;
	if not exists (select 1 from pg_constraint where conname = 'bids_packages') then
		alter table public.bids add constraint bids_packages check (jsonb_typeof(packages) = 'array');
	end if;
	if not exists (select 1 from pg_constraint where conname = 'bid_lines_in_package') then
		alter table public.bid_lines add constraint bid_lines_in_package check (not in_package or (total_minor = 0 and not excluded));
	end if;
end;
$$;

create index if not exists request_items_package on public.request_items (request_id, package_key);

-- The packages of a request change only while it is a draft. They go with their request, by
-- `sg_delete_request`.
create or replace function public.sg_request_packages_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
	ids uuid[];
begin
	if tg_op = 'DELETE' and current_setting('sg.delete_request', true) = old.request_id::text then
		return old;
	end if;
	if tg_op = 'INSERT' then
		ids := array[new.request_id];
	elsif tg_op = 'UPDATE' then
		ids := array[old.request_id, new.request_id];
	else
		ids := array[old.request_id];
	end if;
	-- A cascade from a deleted draft finds no parent. An issued parent cannot be deleted.
	if exists (select 1 from public.bid_requests where id = any (ids) and status <> 'draft') then
		raise exception 'The packages of an issued request are frozen. A change is a new round.' using errcode = 'P0001';
	end if;
	if tg_op = 'DELETE' then
		return old;
	end if;
	return new;
end;
$$;

create or replace trigger request_packages_guard before insert or update or delete on public.request_packages
	for each row execute function public.sg_request_packages_guard();

-- An invitation names only packages of its request. Its packages are fixed once the vendor has
-- submitted a bid, withdrawn or not.
create or replace function public.sg_invitations_packages_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
	if tg_op = 'UPDATE' and new.package_keys is not distinct from old.package_keys then
		return new;
	end if;
	if tg_op = 'UPDATE' and exists (select 1 from public.bids b where b.invitation_id = old.id and b.status <> 'draft') then
		raise exception 'The vendor has submitted a bid. Its packages are fixed.' using errcode = 'P0001';
	end if;
	if new.package_keys is not null and exists (
		select 1 from unnest(new.package_keys) as k(key)
		where not exists (select 1 from public.request_packages p where p.request_id = new.request_id and p.key = k.key)
	) then
		raise exception 'An invitation names only packages of its request.' using errcode = 'P0001';
	end if;
	return new;
end;
$$;

create or replace trigger invitations_packages_guard before insert or update on public.invitations
	for each row execute function public.sg_invitations_packages_guard();

-- A draft bid changes while its invitation is live and its request is issued. A submitted bid is
-- final: the one move left is to withdraw it. It goes with its request, by `sg_delete_request`. A
-- package figure names a package the vendor is invited to: the request's own, or `all` for a request
-- from before packages.
create or replace function public.sg_bids_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
	live boolean;
	request_status text;
	keys text[];
begin
	if tg_op = 'DELETE' then
		if old.status <> 'draft' and current_setting('sg.delete_request', true) is distinct from old.request_id::text then
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

	select i.revoked_at is null and i.expires_at > now(), r.status, i.package_keys
		into live, request_status, keys
		from public.invitations i
		join public.bid_requests r on r.id = i.request_id
		where i.id = new.invitation_id;
	if live is not true then
		raise exception 'The invitation is revoked or expired.' using errcode = 'P0001';
	end if;
	if request_status <> 'issued' then
		raise exception 'The request is not open for bids.' using errcode = 'P0001';
	end if;

	if exists (
		select 1 from jsonb_array_elements(new.packages) as e(price)
		where (keys is not null and not ((e.price ->> 'package') = any (keys)))
			or not (
				exists (select 1 from public.request_packages p where p.request_id = new.request_id and p.key = e.price ->> 'package')
				or (e.price ->> 'package' = 'all' and not exists (select 1 from public.request_packages p where p.request_id = new.request_id))
			)
	) then
		raise exception 'A package price names a package outside your packages.' using errcode = 'P0001';
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

-- The lines of a bid change only while it is a draft, and name only rows of the vendor's packages.
-- They go with their request, by `sg_delete_request`.
create or replace function public.sg_bid_lines_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
	ids uuid[];
	keys text[];
begin
	if tg_op = 'DELETE' and current_setting('sg.delete_request', true) = old.request_id::text then
		return old;
	end if;
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
	select i.package_keys into keys from public.invitations i where i.id = new.invitation_id;
	if keys is not null and not exists (
		select 1 from public.request_items ri
		where ri.request_id = new.request_id and ri.kind = new.item_kind and ri.key = new.item_key and ri.package_key = any (keys)
	) then
		raise exception 'That row is not in your packages.' using errcode = 'P0001';
	end if;
	return new;
end;
$$;

-- Replace a draft request's packages and items, in order, in one write. Each package is
-- `{key, name}`; each item may name its package by `package_key`. A request with packages has every
-- row in one.
create or replace function public.sg_save_request_items(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_items jsonb, p_packages jsonb
) returns setof public.request_items
language plpgsql set search_path = '' as $$
begin
	perform 1 from public.bid_requests
		where id = p_request_id and site_host = p_site_host and project_id = p_project_id and status = 'draft'
		for update;
	if not found then
		raise exception 'No draft request %.', p_request_id using errcode = 'P0002';
	end if;
	if jsonb_typeof(p_packages) <> 'array' then
		raise exception 'The packages are a list.' using errcode = 'P0001';
	end if;
	delete from public.request_items where request_id = p_request_id;
	delete from public.request_packages where request_id = p_request_id;
	insert into public.request_packages (request_id, site_host, project_id, key, name, position)
		select p_request_id, p_site_host, p_project_id, e.pkg ->> 'key', btrim(e.pkg ->> 'name'), (e.ord - 1)::integer
		from jsonb_array_elements(p_packages) with ordinality as e(pkg, ord);
	insert into public.request_items (request_id, site_host, project_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source, package_key)
		select p_request_id, p_site_host, p_project_id,
			e.item ->> 'kind', e.item ->> 'key', e.item ->> 'code', (e.ord - 1)::integer,
			e.item ->> 'fpt_type', (e.item ->> 'fpt_id')::bigint,
			coalesce(e.item -> 'fields', '{}'::jsonb), coalesce((e.item ->> 'omitted')::boolean, false),
			coalesce(e.item ->> 'source', 'fpt'), e.item ->> 'package_key'
		from jsonb_array_elements(p_items) with ordinality as e(item, ord);
	if exists (select 1 from public.request_packages where request_id = p_request_id)
		and exists (select 1 from public.request_items where request_id = p_request_id and package_key is null) then
		raise exception 'Every row of a request with packages sits in one.' using errcode = 'P0001';
	end if;
	return query select * from public.request_items where request_id = p_request_id order by position;
end;
$$;

-- The call from before packages: the items alone. The request's packages go with it, so no row is
-- left outside one.
create or replace function public.sg_save_request_items(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_items jsonb
) returns setof public.request_items
language plpgsql set search_path = '' as $$
begin
	return query select * from public.sg_save_request_items(p_request_id, p_site_host, p_project_id,
		(select coalesce(jsonb_agg(e.item - 'package_key' order by e.ord), '[]'::jsonb) from jsonb_array_elements(p_items) with ordinality as e(item, ord)),
		'[]'::jsonb);
end;
$$;

-- Write the invitation's draft bid and its lines: update the draft there is, or open the next
-- version. Returns the bid's id. The bid's package figures and each line's `in_package` travel too.
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
			exchange_rate, exchange_rate_date, header, non_shot_costs, rebate_splits, packages)
		values (inv.id, inv.request_id, inv.site_host, inv.project_id,
			(select coalesce(max(version), 0) + 1 from public.bids where invitation_id = inv.id),
			'draft', p_bid ->> 'currency', p_bid ->> 'exchange_rate', (p_bid ->> 'exchange_rate_date')::date,
			coalesce(p_bid -> 'header', '{}'::jsonb), coalesce(p_bid -> 'non_shot_costs', '[]'::jsonb),
			coalesce(p_bid -> 'rebate_splits', '[]'::jsonb), coalesce(p_bid -> 'packages', '[]'::jsonb))
		returning id into draft;
	else
		update public.bids set
			currency = p_bid ->> 'currency',
			exchange_rate = p_bid ->> 'exchange_rate',
			exchange_rate_date = (p_bid ->> 'exchange_rate_date')::date,
			header = coalesce(p_bid -> 'header', '{}'::jsonb),
			non_shot_costs = coalesce(p_bid -> 'non_shot_costs', '[]'::jsonb),
			rebate_splits = coalesce(p_bid -> 'rebate_splits', '[]'::jsonb),
			packages = coalesce(p_bid -> 'packages', '[]'::jsonb)
		where id = draft;
		delete from public.bid_lines where bid_id = draft;
	end if;
	insert into public.bid_lines (bid_id, invitation_id, request_id, site_host, project_id, item_kind, item_key, total_minor, excluded, detail, in_package)
		select draft, inv.id, inv.request_id, inv.site_host, inv.project_id,
			l ->> 'item_kind', l ->> 'item_key', (l ->> 'total_minor')::bigint,
			coalesce((l ->> 'excluded')::boolean, false), coalesce(l -> 'detail', '{}'::jsonb),
			coalesce((l ->> 'in_package')::boolean, false)
		from jsonb_array_elements(p_lines) as l;
	return draft;
end;
$$;

-- Delete a request and everything under it, in the caller's tenant: draft, issued, awarded and
-- undone, or closed. Refused while an award is in Flow PT. Answers what went, counted.
create or replace function public.sg_delete_request(
	p_request_id uuid, p_site_host text, p_project_id bigint
) returns jsonb
language plpgsql set search_path = '' as $$
declare
	request public.bid_requests;
	gone jsonb;
	n integer;
begin
	select * into request from public.bid_requests
		where id = p_request_id and site_host = p_site_host and project_id = p_project_id
		for update;
	if not found then
		raise exception 'No such request.' using errcode = 'P0002';
	end if;
	if exists (select 1 from public.award_publications where request_id = request.id)
		or exists (select 1 from public.awards where request_id = request.id) then
		raise exception 'The award is in Flow PT. Undo the award first.' using errcode = 'P0001';
	end if;

	perform set_config('sg.delete_request', request.id::text, true);

	insert into public.withdrawn_links (token_hash)
		select distinct h from public.invitations i, unnest(i.replaced_token_hashes || i.token_hash) as h
		where i.request_id = request.id
		on conflict (token_hash) do nothing;

	gone := jsonb_build_object('code', request.code, 'round', request.round, 'status', request.status);
	select jsonb_build_object(
		'invitations', (select count(*) from public.invitations where request_id = request.id),
		'bids', (select count(*) from public.bids where request_id = request.id and status <> 'draft'),
		'drafts', (select count(*) from public.bids where request_id = request.id and status = 'draft'),
		'lines', (select count(*) from public.bid_lines where request_id = request.id),
		'scenarios', (select count(*) from public.award_scenarios where request_id = request.id),
		'rates', (select count(*) from public.bid_rates where request_id = request.id),
		'items', (select count(*) from public.request_items where request_id = request.id)
	) || gone into gone;

	delete from public.award_scenario_items where request_id = request.id;
	delete from public.award_scenarios where request_id = request.id;
	delete from public.bid_rates where request_id = request.id;
	delete from public.bid_lines where request_id = request.id;
	delete from public.bids where request_id = request.id;
	delete from public.invitations where request_id = request.id;
	delete from public.request_items where request_id = request.id;
	delete from public.request_packages where request_id = request.id;
	delete from public.bid_requests where id = request.id;
	get diagnostics n = row_count;
	if n <> 1 then
		raise exception 'The request did not delete.' using errcode = 'P0001';
	end if;

	perform set_config('sg.delete_request', '', true);
	return gone;
end;
$$;

alter table public.request_packages enable row level security;

revoke all on table public.request_packages from anon, authenticated;
grant select, insert, update, delete on table public.request_packages to service_role;

revoke all on function
	public.sg_request_packages_guard(), public.sg_invitations_packages_guard(),
	public.sg_bids_guard(), public.sg_bid_lines_guard(),
	public.sg_save_request_items(uuid, text, bigint, jsonb, jsonb),
	public.sg_save_request_items(uuid, text, bigint, jsonb),
	public.sg_save_bid_draft(uuid, jsonb, jsonb),
	public.sg_delete_request(uuid, text, bigint)
	from public, anon, authenticated;
grant execute on function
	public.sg_save_request_items(uuid, text, bigint, jsonb, jsonb),
	public.sg_save_request_items(uuid, text, bigint, jsonb),
	public.sg_save_bid_draft(uuid, jsonb, jsonb),
	public.sg_delete_request(uuid, text, bigint)
	to service_role;
