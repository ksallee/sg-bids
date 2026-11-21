-- sg-bids bids first: a bid is a named set of rows in a project, built and edited on its own, and a
-- request is made from one or several bids.
--
--   - `production_bids`: production's bids, per tenant. A name (not unique: a clone is `<name> copy`),
--     and the counts the Bids list shows, kept by the functions that write the rows. Always editable:
--     no freeze. In the code a production bid is the bid production builds; `bids` stays the table of
--     the vendors' answers.
--   - `production_bid_items`: a bid's rows, the columns of `request_items` without the package.
--   - `request_packages.bid_id`: the bid a request's package comes from. A draft request holds its
--     bids by reference: one package per bid, no rows of its own. Issuing copies each bid's rows into
--     `request_items` under its package, with the bid's name, and the request freezes as before
--     (`sg_issue_request`). After that the bid changes, goes out again in another request or is
--     deleted, and what was issued stays as it was. A package made before this has no bid.
--   - `invitations.link_pending`: a vendor added to a draft request whose link is made at the issue,
--     shown once then. A vendor invited before this keeps its link.
--
-- Writes that must land whole are functions, each filtered on the caller's tenant: save a bid with
-- its rows, clone one, delete one (out of its drafts, kept where it was issued), move or copy rows
-- between bids, set a draft request's bids, issue a request.
--
-- Existing data: every draft request with rows or packages becomes its bids, one per package, or one
-- for a draft from before packages, and a draft request that references them
-- (`sg_bids_first_convert`). Every row lands in a bid as it was. An issued request is not touched.
--
-- Idempotent: safe to apply again.

create table if not exists public.production_bids (
	id uuid primary key default gen_random_uuid(),
	site_host text not null check (site_host ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'),
	project_id bigint not null check (project_id > 0),
	name text not null check (length(name) between 1 and 120 and name = btrim(name)),
	-- Kept by the functions below: the rows not omitted, by kind, the omitted ones, the frames of the shots in.
	shot_count integer not null default 0 check (shot_count >= 0),
	asset_count integer not null default 0 check (asset_count >= 0),
	omitted_count integer not null default 0 check (omitted_count >= 0),
	frame_count bigint not null default 0 check (frame_count >= 0),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint production_bids_tenant_key unique (id, site_host, project_id)
);

create index if not exists production_bids_tenant on public.production_bids (site_host, project_id);

create table if not exists public.production_bid_items (
	id uuid primary key default gen_random_uuid(),
	bid_id uuid not null,
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
	source text not null default 'fpt' check (source in ('fpt', 'breakdown')),
	constraint production_bid_items_fpt check ((fpt_type is null) = (fpt_id is null)),
	constraint production_bid_items_key unique (bid_id, kind, key),
	constraint production_bid_items_bid foreign key (bid_id, site_host, project_id)
		references public.production_bids (id, site_host, project_id) on delete cascade
);

alter table public.request_packages add column if not exists bid_id uuid;
alter table public.invitations add column if not exists link_pending boolean not null default false;

do $$
begin
	if not exists (select 1 from pg_constraint where conname = 'request_packages_bid') then
		alter table public.request_packages add constraint request_packages_bid foreign key (bid_id, site_host, project_id)
			references public.production_bids (id, site_host, project_id);
	end if;
end;
$$;

create unique index if not exists request_packages_one_bid on public.request_packages (request_id, bid_id) where bid_id is not null;
create index if not exists request_packages_bid_id on public.request_packages (bid_id) where bid_id is not null;

create or replace trigger production_bids_touch before update on public.production_bids
	for each row execute function public.sg_touch_updated_at();

-- The packages of a request change only while it is a draft. They go with their request, by
-- `sg_delete_request`. A bid that is deleted leaves the requests it went out in: its id is cleared
-- from their packages and nothing else changes.
create or replace function public.sg_request_packages_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
	ids uuid[];
begin
	if tg_op = 'DELETE' and current_setting('sg.delete_request', true) = old.request_id::text then
		return old;
	end if;
	if tg_op = 'UPDATE' and old.bid_id is not null and new.bid_id is null
		and (to_jsonb(new) - 'bid_id') = (to_jsonb(old) - 'bid_id') then
		return new;
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

-- The counts a bid's row carries, from its rows as they are now.
create or replace function public.sg_production_bid_counts(p_bid_id uuid, p_site_host text, p_project_id bigint) returns void
language sql set search_path = '' as $$
	update public.production_bids b set
		shot_count = c.shots,
		asset_count = c.assets,
		omitted_count = c.omitted,
		frame_count = c.frames
	from (
		select
			count(*) filter (where kind = 'shot' and not omitted)::integer as shots,
			count(*) filter (where kind = 'asset' and not omitted)::integer as assets,
			count(*) filter (where omitted)::integer as omitted,
			coalesce(sum(case when kind = 'shot' and not omitted and jsonb_typeof(fields -> 'frames') = 'number' and (fields ->> 'frames')::numeric >= 0
				then floor((fields ->> 'frames')::numeric)::bigint end), 0)::bigint as frames
		from public.production_bid_items
		where bid_id = p_bid_id and site_host = p_site_host and project_id = p_project_id
	) c
	where b.id = p_bid_id and b.site_host = p_site_host and b.project_id = p_project_id;
$$;

-- Create a bid (`p_bid_id` null) or replace one's name and rows, in order, in the caller's tenant.
-- Each row is `{kind, key, code, fpt_type, fpt_id, fields, omitted, source}`. Answers the bid's id.
create or replace function public.sg_save_production_bid(
	p_bid_id uuid, p_site_host text, p_project_id bigint, p_name text, p_items jsonb
) returns uuid
language plpgsql set search_path = '' as $$
declare
	bid uuid;
begin
	if jsonb_typeof(p_items) <> 'array' then
		raise exception 'The rows are a list.' using errcode = 'P0001';
	end if;
	if p_bid_id is null then
		insert into public.production_bids (site_host, project_id, name)
			values (p_site_host, p_project_id, btrim(p_name))
			returning id into bid;
	else
		update public.production_bids set name = btrim(p_name)
			where id = p_bid_id and site_host = p_site_host and project_id = p_project_id
			returning id into bid;
		if bid is null then
			raise exception 'No such bid.' using errcode = 'P0002';
		end if;
		delete from public.production_bid_items where bid_id = bid;
	end if;
	insert into public.production_bid_items (bid_id, site_host, project_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source)
		select bid, p_site_host, p_project_id,
			e.item ->> 'kind', e.item ->> 'key', e.item ->> 'code', (e.ord - 1)::integer,
			e.item ->> 'fpt_type', (e.item ->> 'fpt_id')::bigint,
			coalesce(e.item -> 'fields', '{}'::jsonb), coalesce((e.item ->> 'omitted')::boolean, false),
			coalesce(e.item ->> 'source', 'fpt')
		from jsonb_array_elements(p_items) with ordinality as e(item, ord);
	perform public.sg_production_bid_counts(bid, p_site_host, p_project_id);
	return bid;
end;
$$;

-- A name no other bid of the tenant holds, in any case: the name, else `<name> 2`, `<name> 3`.
create or replace function public.sg_free_bid_name(p_site_host text, p_project_id bigint, p_name text) returns text
language plpgsql set search_path = '' as $$
declare
	candidate text := p_name;
	n integer := 1;
begin
	while exists (
		select 1 from public.production_bids
		where site_host = p_site_host and project_id = p_project_id and lower(name) = lower(candidate)
	) loop
		n := n + 1;
		candidate := btrim(left(p_name, 120 - length(n::text) - 1)) || ' ' || n;
	end loop;
	return candidate;
end;
$$;

-- A copy of a bid, named `<name> copy` (made free in the tenant), with every row. Answers its id.
create or replace function public.sg_clone_production_bid(p_bid_id uuid, p_site_host text, p_project_id bigint) returns uuid
language plpgsql set search_path = '' as $$
declare
	original public.production_bids;
	copy uuid;
begin
	select * into original from public.production_bids
		where id = p_bid_id and site_host = p_site_host and project_id = p_project_id;
	if not found then
		raise exception 'No such bid.' using errcode = 'P0002';
	end if;
	insert into public.production_bids (site_host, project_id, name)
		values (p_site_host, p_project_id, public.sg_free_bid_name(p_site_host, p_project_id, btrim(left(original.name, 115)) || ' copy'))
		returning id into copy;
	insert into public.production_bid_items (bid_id, site_host, project_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source)
		select copy, site_host, project_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source
		from public.production_bid_items where bid_id = original.id;
	perform public.sg_production_bid_counts(copy, p_site_host, p_project_id);
	return copy;
end;
$$;

-- Rows of one bid to another, in the caller's tenant: copied, or moved (`p_move`). Each row is
-- `{kind, key}`. A row the other bid holds already stays as it is there. Answers how many it took.
create or replace function public.sg_move_bid_rows(
	p_from uuid, p_to uuid, p_site_host text, p_project_id bigint, p_rows jsonb, p_move boolean
) returns integer
language plpgsql set search_path = '' as $$
declare
	start integer;
	n integer;
begin
	if p_from = p_to then
		raise exception 'Pick another bid.' using errcode = 'P0001';
	end if;
	perform 1 from public.production_bids
		where id in (p_from, p_to) and site_host = p_site_host and project_id = p_project_id
		for update;
	if (select count(*) from public.production_bids where id in (p_from, p_to) and site_host = p_site_host and project_id = p_project_id) <> 2 then
		raise exception 'No such bid.' using errcode = 'P0002';
	end if;
	if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
		raise exception 'Name the rows.' using errcode = 'P0001';
	end if;
	select coalesce(max(position) + 1, 0) into start from public.production_bid_items where bid_id = p_to;
	insert into public.production_bid_items (bid_id, site_host, project_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source)
		select p_to, i.site_host, i.project_id, i.kind, i.key, i.code, start + row_number() over (order by i.position)::integer - 1,
			i.fpt_type, i.fpt_id, i.fields, i.omitted, i.source
		from public.production_bid_items i
		join jsonb_array_elements(p_rows) as r(row) on r.row ->> 'kind' = i.kind and r.row ->> 'key' = i.key
		where i.bid_id = p_from
			and not exists (select 1 from public.production_bid_items t where t.bid_id = p_to and t.kind = i.kind and t.key = i.key);
	get diagnostics n = row_count;
	if p_move then
		delete from public.production_bid_items i
			using jsonb_array_elements(p_rows) as r(row)
			where i.bid_id = p_from and r.row ->> 'kind' = i.kind and r.row ->> 'key' = i.key;
		perform public.sg_production_bid_counts(p_from, p_site_host, p_project_id);
	end if;
	perform public.sg_production_bid_counts(p_to, p_site_host, p_project_id);
	return n;
end;
$$;

-- Delete a bid, in the caller's tenant. It leaves the draft requests it is in, with each vendor's
-- choice of it; refused when a vendor of one is invited to it alone. The requests it went out in keep
-- what was issued. Answers its name and those requests.
create or replace function public.sg_delete_production_bid(p_bid_id uuid, p_site_host text, p_project_id bigint) returns jsonb
language plpgsql set search_path = '' as $$
declare
	bid public.production_bids;
	stuck text;
	drafts jsonb;
	issued jsonb;
begin
	select * into bid from public.production_bids
		where id = p_bid_id and site_host = p_site_host and project_id = p_project_id
		for update;
	if not found then
		raise exception 'No such bid.' using errcode = 'P0002';
	end if;
	select i.vendor_name into stuck
		from public.request_packages p
		join public.bid_requests r on r.id = p.request_id and r.status = 'draft'
		join public.invitations i on i.request_id = p.request_id
		where p.bid_id = bid.id and i.package_keys is not null and i.package_keys <@ array[p.key]
		limit 1;
	if stuck is not null then
		raise exception '% is invited to this bid alone in a draft request. Give it another bid first.', stuck using errcode = 'P0001';
	end if;
	select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'round', r.round) order by r.created_at), '[]'::jsonb) into drafts
		from public.request_packages p join public.bid_requests r on r.id = p.request_id
		where p.bid_id = bid.id and r.status = 'draft';
	select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'round', r.round) order by r.created_at), '[]'::jsonb) into issued
		from public.request_packages p join public.bid_requests r on r.id = p.request_id
		where p.bid_id = bid.id and r.status <> 'draft';

	update public.invitations i set package_keys = array_remove(i.package_keys, p.key)
		from public.request_packages p
		join public.bid_requests r on r.id = p.request_id and r.status = 'draft'
		where p.bid_id = bid.id and i.request_id = p.request_id and p.key = any (i.package_keys);
	delete from public.request_packages p
		using public.bid_requests r
		where p.bid_id = bid.id and r.id = p.request_id and r.status = 'draft';
	update public.request_packages set bid_id = null where bid_id = bid.id;
	delete from public.production_bids where id = bid.id;
	return jsonb_build_object('name', bid.name, 'drafts', drafts, 'issued', issued);
end;
$$;

-- Set a draft request's bids, in order, in the caller's tenant. A bid kept keeps its package, so a
-- vendor's choice of it stands; a bid taken out leaves each vendor's choice; refused when a vendor
-- would be left with no bid. A new bid's package is `bid:<id>`, named as the bid, made unique in the
-- request. A draft that holds rows of its own (made before bids) takes no bids.
create or replace function public.sg_set_request_bids(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_bid_ids jsonb
) returns void
language plpgsql set search_path = '' as $$
declare
	request public.bid_requests;
	wanted uuid[];
	stuck text;
	entry record;
	label text;
	taken text[];
	n integer;
begin
	select * into request from public.bid_requests
		where id = p_request_id and site_host = p_site_host and project_id = p_project_id
		for update;
	if not found or request.status <> 'draft' then
		raise exception 'No draft request %.', p_request_id using errcode = 'P0002';
	end if;
	if jsonb_typeof(p_bid_ids) <> 'array' then
		raise exception 'The bids are a list.' using errcode = 'P0001';
	end if;
	select coalesce(array_agg(e.id::uuid order by e.ord), '{}') into wanted from jsonb_array_elements_text(p_bid_ids) with ordinality as e(id, ord);
	if cardinality(wanted) <> (select count(distinct x) from unnest(wanted) as x) then
		raise exception 'A bid is named twice.' using errcode = 'P0001';
	end if;
	if exists (
		select 1 from unnest(wanted) as w(id)
		where not exists (select 1 from public.production_bids b where b.id = w.id and b.site_host = p_site_host and b.project_id = p_project_id)
	) then
		raise exception 'A bid is not in this project.' using errcode = 'P0001';
	end if;
	if exists (select 1 from public.request_items where request_id = request.id)
		or exists (select 1 from public.request_packages where request_id = request.id and bid_id is null) then
		raise exception 'This draft holds rows of its own. It takes no bids.' using errcode = 'P0001';
	end if;

	select i.vendor_name into stuck
		from public.invitations i
		where i.request_id = request.id and i.package_keys is not null
			and not exists (
				select 1 from unnest(i.package_keys) as k(key)
				join public.request_packages p on p.request_id = request.id and p.key = k.key
				where p.bid_id = any (wanted)
			)
		limit 1;
	if stuck is not null then
		raise exception '% is invited to none of these bids. Give it one first.', stuck using errcode = 'P0001';
	end if;

	update public.invitations i set package_keys = (
			select array_agg(k.key order by k.ord) from unnest(i.package_keys) with ordinality as k(key, ord)
			where exists (select 1 from public.request_packages p where p.request_id = request.id and p.key = k.key and p.bid_id = any (wanted))
		)
		where i.request_id = request.id and i.package_keys is not null
			and exists (
				select 1 from unnest(i.package_keys) as k(key)
				join public.request_packages p on p.request_id = request.id and p.key = k.key
				where not (p.bid_id = any (wanted))
			);
	delete from public.request_packages where request_id = request.id and not (bid_id = any (wanted));

	select coalesce(array_agg(lower(name)), '{}') into taken from public.request_packages where request_id = request.id;
	for entry in select w.id, w.ord from unnest(wanted) with ordinality as w(id, ord) loop
		if exists (select 1 from public.request_packages where request_id = request.id and bid_id = entry.id) then
			update public.request_packages set position = entry.ord - 1 where request_id = request.id and bid_id = entry.id;
		else
			select b.name into label from public.production_bids b where b.id = entry.id;
			n := 1;
			while lower(label) = any (taken) loop
				n := n + 1;
				select btrim(left(b.name, 120 - length(n::text) - 1)) || ' ' || n into label from public.production_bids b where b.id = entry.id;
			end loop;
			taken := taken || lower(label);
			insert into public.request_packages (request_id, site_host, project_id, key, name, position, bid_id)
				values (request.id, p_site_host, p_project_id, 'bid:' || entry.id, label, entry.ord - 1, entry.id);
		end if;
	end loop;
end;
$$;

-- Issue a draft request, in the caller's tenant, in one write. Each bid's rows are copied as they are
-- now into the request under its package, which takes the bid's name, made unique in the request; a
-- row in two bids of the request refuses the issue. Each vendor added to the draft gets its link now:
-- `p_links` is `[{invitation_id, token_hash, expires_at}]`, one per such vendor, no more, no fewer.
-- Then the request is issued and freezes (`sg_bid_requests_guard`).
create or replace function public.sg_issue_request(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_links jsonb
) returns void
language plpgsql set search_path = '' as $$
declare
	request public.bid_requests;
	twice record;
	pkg record;
	label text;
	taken text[] := '{}';
	n integer;
	start integer := 0;
	pending uuid[];
	given uuid[];
	stale text;
begin
	select * into request from public.bid_requests
		where id = p_request_id and site_host = p_site_host and project_id = p_project_id
		for update;
	if not found or request.status <> 'draft' then
		raise exception 'No draft request %.', p_request_id using errcode = 'P0002';
	end if;
	if jsonb_typeof(p_links) <> 'array' then
		raise exception 'The links are a list.' using errcode = 'P0001';
	end if;

	select a.code, ba.name as first, bb.name as second into twice
		from public.request_packages pa
		join public.production_bid_items a on a.bid_id = pa.bid_id
		join public.request_packages pb on pb.request_id = pa.request_id and (pb.position, pb.id) > (pa.position, pa.id)
		join public.production_bid_items b on b.bid_id = pb.bid_id and b.kind = a.kind and b.key = a.key
		join public.production_bids ba on ba.id = pa.bid_id
		join public.production_bids bb on bb.id = pb.bid_id
		where pa.request_id = request.id
		order by pa.position, a.position
		limit 1;
	if found then
		raise exception '% is in % and in %. A request takes each row once.', twice.code, twice.first, twice.second using errcode = 'P0001';
	end if;

	select coalesce(array_agg(lower(name)), '{}') into taken from public.request_packages where request_id = request.id and bid_id is null;
	update public.request_packages set name = '~' || position || ' ' || left(md5(key), 16)
		where request_id = request.id and bid_id is not null;
	for pkg in
		select p.id, p.key, p.bid_id, b.name from public.request_packages p join public.production_bids b on b.id = p.bid_id
		where p.request_id = request.id order by p.position
	loop
		label := pkg.name;
		n := 1;
		while lower(label) = any (taken) loop
			n := n + 1;
			label := btrim(left(pkg.name, 120 - length(n::text) - 1)) || ' ' || n;
		end loop;
		taken := taken || lower(label);
		update public.request_packages set name = label where id = pkg.id;
		insert into public.request_items (request_id, site_host, project_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source, package_key)
			select request.id, request.site_host, request.project_id, i.kind, i.key, i.code,
				start + (row_number() over (order by i.position))::integer - 1,
				i.fpt_type, i.fpt_id, i.fields, i.omitted, i.source, pkg.key
			from public.production_bid_items i where i.bid_id = pkg.bid_id;
		get diagnostics n = row_count;
		start := start + n;
	end loop;

	select k.key into stale
		from public.invitations i, unnest(i.package_keys) as k(key)
		where i.request_id = request.id
			and not exists (select 1 from public.request_packages p where p.request_id = request.id and p.key = k.key)
		limit 1;
	if stale is not null then
		raise exception 'A vendor is invited to a bid no longer in the request. Pick its bids again.' using errcode = 'P0001';
	end if;

	select coalesce(array_agg(id order by id), '{}') into pending from public.invitations where request_id = request.id and link_pending;
	select coalesce(array_agg((e ->> 'invitation_id')::uuid order by (e ->> 'invitation_id')::uuid), '{}') into given from jsonb_array_elements(p_links) as e;
	if pending is distinct from given then
		raise exception 'The vendors changed while you issued. Reload the page.' using errcode = 'P0001';
	end if;
	update public.invitations i set
		token_hash = e ->> 'token_hash',
		expires_at = (e ->> 'expires_at')::timestamptz,
		revoked_at = null,
		link_pending = false
		from jsonb_array_elements(p_links) as e
		where i.id = (e ->> 'invitation_id')::uuid and i.request_id = request.id and i.link_pending;

	update public.bid_requests set status = 'issued' where id = request.id;
end;
$$;

-- Every draft request with rows or packages, made before bids, becomes its bids and a draft that
-- references them: one bid per package, named as it, with its rows; a draft from before packages
-- makes one bid of every row, named after the request's title, else its code. A row in no package
-- goes to one more bid, Other rows. The draft keeps its packages, so each vendor's choice stands,
-- and its rows move to the bids. Answers how many drafts it turned. Applied again it finds none.
create or replace function public.sg_bids_first_convert() returns integer
language plpgsql set search_path = '' as $$
declare
	r public.bid_requests;
	p public.request_packages;
	bid uuid;
	label text;
	taken text[];
	n integer;
	turned integer := 0;
begin
	for r in
		select * from public.bid_requests q
		where q.status = 'draft'
			and not exists (select 1 from public.request_packages x where x.request_id = q.id and x.bid_id is not null)
			and (exists (select 1 from public.request_items x where x.request_id = q.id)
				or exists (select 1 from public.request_packages x where x.request_id = q.id))
		order by q.created_at
	loop
		for p in select * from public.request_packages where request_id = r.id order by position loop
			insert into public.production_bids (site_host, project_id, name, created_at)
				values (r.site_host, r.project_id, p.name, r.created_at)
				returning id into bid;
			insert into public.production_bid_items (bid_id, site_host, project_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source)
				select bid, r.site_host, r.project_id, i.kind, i.key, i.code, i.position, i.fpt_type, i.fpt_id, i.fields, i.omitted, i.source
				from public.request_items i where i.request_id = r.id and i.package_key = p.key;
			perform public.sg_production_bid_counts(bid, r.site_host, r.project_id);
			update public.request_packages set bid_id = bid where id = p.id;
		end loop;

		if exists (
			select 1 from public.request_items i
			where i.request_id = r.id
				and (i.package_key is null or not exists (select 1 from public.request_packages x where x.request_id = r.id and x.key = i.package_key))
		) then
			if exists (select 1 from public.request_packages where request_id = r.id) then
				label := 'Other rows';
			else
				label := btrim(left(btrim(coalesce(nullif(btrim(r.header ->> 'title'), ''), r.code)), 120));
				if label = '' then
					label := 'Untitled bid';
				end if;
			end if;
			insert into public.production_bids (site_host, project_id, name, created_at)
				values (r.site_host, r.project_id, label, r.created_at)
				returning id into bid;
			insert into public.production_bid_items (bid_id, site_host, project_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source)
				select bid, r.site_host, r.project_id, i.kind, i.key, i.code, i.position, i.fpt_type, i.fpt_id, i.fields, i.omitted, i.source
				from public.request_items i
				where i.request_id = r.id
					and (i.package_key is null or not exists (select 1 from public.request_packages x where x.request_id = r.id and x.key = i.package_key));
			perform public.sg_production_bid_counts(bid, r.site_host, r.project_id);
			select coalesce(array_agg(lower(name)), '{}') into taken from public.request_packages where request_id = r.id;
			n := 1;
			while lower(label) = any (taken) loop
				n := n + 1;
				label := btrim(left(label, 120 - length(n::text) - 1)) || ' ' || n;
			end loop;
			insert into public.request_packages (request_id, site_host, project_id, key, name, position, bid_id)
				values (r.id, r.site_host, r.project_id, 'bid:' || bid, label,
					(select coalesce(max(position) + 1, 0) from public.request_packages where request_id = r.id), bid);
		end if;

		delete from public.request_items where request_id = r.id;
		turned := turned + 1;
	end loop;
	return turned;
end;
$$;

select public.sg_bids_first_convert();

alter table public.production_bids enable row level security;
alter table public.production_bid_items enable row level security;

revoke all on table public.production_bids, public.production_bid_items from anon, authenticated;
grant select, insert, update, delete on table public.production_bids, public.production_bid_items to service_role;

revoke all on function
	public.sg_request_packages_guard(),
	public.sg_production_bid_counts(uuid, text, bigint),
	public.sg_save_production_bid(uuid, text, bigint, text, jsonb),
	public.sg_free_bid_name(text, bigint, text),
	public.sg_clone_production_bid(uuid, text, bigint),
	public.sg_move_bid_rows(uuid, uuid, text, bigint, jsonb, boolean),
	public.sg_delete_production_bid(uuid, text, bigint),
	public.sg_set_request_bids(uuid, text, bigint, jsonb),
	public.sg_issue_request(uuid, text, bigint, jsonb),
	public.sg_bids_first_convert()
	from public, anon, authenticated, service_role;
grant execute on function
	public.sg_production_bid_counts(uuid, text, bigint),
	public.sg_save_production_bid(uuid, text, bigint, text, jsonb),
	public.sg_free_bid_name(text, bigint, text),
	public.sg_clone_production_bid(uuid, text, bigint),
	public.sg_move_bid_rows(uuid, uuid, text, bigint, jsonb, boolean),
	public.sg_delete_production_bid(uuid, text, bigint),
	public.sg_set_request_bids(uuid, text, bigint, jsonb),
	public.sg_issue_request(uuid, text, bigint, jsonb)
	to service_role;
