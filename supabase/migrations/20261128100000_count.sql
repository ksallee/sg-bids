-- sg-bids rows by count: one row of a request standing for many shots or assets of a kind (120
-- simple comps, 40 medium). Additive: one column on each table of rows, and the functions that copy
-- rows learn it.
--
--   - `unit_count` on `production_bid_items` (a draft's rows) and `request_items` (an issued
--     request's): a whole number from 1 to 100,000, 1 by default, so every row stored before reads as
--     1. A row linked to a Flow PT Shot or Asset is one: its count is 1 (`*_unit_count_fpt`).
--   - The freeze of an issued request covers it as it covers every column: `sg_request_items_guard`
--     compares the whole row, so a count never changes after the issue, and the one change it allows
--     (a breakdown row getting its Flow PT row) cannot come with one.
--   - `sg_save_draft`: each row may carry `unit_count`; a row without it is 1. A caller from before
--     this migration sends none, and its rows are 1.
--   - `sg_issue_request`: copies `unit_count` with the row, and refuses a row with no code (a row
--     typed by hand starts with none).
--   - `sg_link_request_items`: refuses a counted row. It stands for many shots, and is never linked
--     to one.
--   - `sg_production_bid_counts`: a counted row counts as many shots or assets as it stands for, its
--     frames per unit times its count.
--   - A vendor's line on a counted row keeps its unit price in `bid_lines.detail` (`unit`), the
--     total in `total_minor` as before: no column. A submitted bid's lines are frozen as before.
--
-- Code from before this migration runs on it unchanged: it reads `select *` and ignores the column,
-- it writes no count, and every row it writes is 1.
--
-- Idempotent: safe to apply again.

alter table public.production_bid_items add column if not exists unit_count integer not null default 1;
alter table public.request_items add column if not exists unit_count integer not null default 1;

do $$
begin
	if not exists (select 1 from pg_constraint where conname = 'production_bid_items_unit_count') then
		alter table public.production_bid_items add constraint production_bid_items_unit_count check (unit_count between 1 and 100000);
	end if;
	if not exists (select 1 from pg_constraint where conname = 'production_bid_items_unit_count_fpt') then
		alter table public.production_bid_items add constraint production_bid_items_unit_count_fpt check (fpt_id is null or unit_count = 1);
	end if;
	if not exists (select 1 from pg_constraint where conname = 'request_items_unit_count') then
		alter table public.request_items add constraint request_items_unit_count check (unit_count between 1 and 100000);
	end if;
	if not exists (select 1 from pg_constraint where conname = 'request_items_unit_count_fpt') then
		alter table public.request_items add constraint request_items_unit_count_fpt check (fpt_id is null or unit_count = 1);
	end if;
end;
$$;

-- The counts a bid's row carries, from its rows as they are now. A counted row counts as many.
create or replace function public.sg_production_bid_counts(p_bid_id uuid, p_site_host text, p_project_id bigint) returns void
language sql set search_path = '' as $$
	update public.production_bids b set
		shot_count = c.shots,
		asset_count = c.assets,
		omitted_count = c.omitted,
		frame_count = c.frames
	from (
		select
			coalesce(sum(unit_count) filter (where kind = 'shot' and not omitted), 0)::integer as shots,
			coalesce(sum(unit_count) filter (where kind = 'asset' and not omitted), 0)::integer as assets,
			count(*) filter (where omitted)::integer as omitted,
			coalesce(sum(case when kind = 'shot' and not omitted and jsonb_typeof(fields -> 'frames') = 'number' and (fields ->> 'frames')::numeric >= 0
				then floor((fields ->> 'frames')::numeric)::bigint * unit_count end), 0)::bigint as frames
		from public.production_bid_items
		where bid_id = p_bid_id and site_host = p_site_host and project_id = p_project_id
	) c
	where b.id = p_bid_id and b.site_host = p_site_host and b.project_id = p_project_id;
$$;

-- A draft's bids, in order, and its vendors, in one write in the caller's tenant. As in
-- `20261127100000_one_page.sql`; each item may carry `unit_count`, 1 when it does not.
create or replace function public.sg_save_draft(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_bids jsonb, p_vendors jsonb
) returns void
language plpgsql set search_path = '' as $$
declare
	request public.bid_requests;
	keys text[];
	entry record;
	bid uuid;
	label text;
begin
	select * into request from public.bid_requests
		where id = p_request_id and site_host = p_site_host and project_id = p_project_id
		for update;
	if not found or request.status <> 'draft' then
		raise exception 'No draft request %.', p_request_id using errcode = 'P0002';
	end if;
	if jsonb_typeof(p_bids) is distinct from 'array' or jsonb_array_length(p_bids) = 0 then
		raise exception 'A request holds one bid at least.' using errcode = 'P0001';
	end if;
	if p_vendors is not null and jsonb_typeof(p_vendors) <> 'array' then
		raise exception 'The vendors are a list.' using errcode = 'P0001';
	end if;
	if exists (select 1 from public.request_items where request_id = request.id)
		or exists (select 1 from public.request_packages where request_id = request.id and bid_id is null) then
		raise exception 'This draft holds rows of its own. Reload the page.' using errcode = 'P0001';
	end if;
	select array_agg(e ->> 'key' order by ord) into keys from jsonb_array_elements(p_bids) with ordinality as x(e, ord);
	if array_position(keys, null) is not null or cardinality(keys) <> (select count(distinct k) from unnest(keys) as k) then
		raise exception 'Each bid needs a key of its own.' using errcode = 'P0001';
	end if;
	if (select count(distinct lower(btrim(coalesce(e ->> 'name', '')))) from jsonb_array_elements(p_bids) as e) <> cardinality(keys) then
		raise exception 'Two bids have the same name. Give each its own.' using errcode = 'P0001';
	end if;

	-- The bids left out go, with their rows. The vendors invited to them lose them.
	update public.invitations i set package_keys = (
			select array_agg(k.key order by k.ord) from unnest(i.package_keys) with ordinality as k(key, ord) where k.key = any (keys)
		)
		where i.request_id = request.id and i.package_keys is not null and not (i.package_keys <@ keys);
	with gone as (
		delete from public.request_packages where request_id = request.id and not (key = any (keys)) returning bid_id
	)
	delete from public.production_bids where request_id = request.id and id in (select bid_id from gone);

	-- Names free first, so two bids may trade theirs.
	update public.request_packages set name = '~' || md5(key) where request_id = request.id;
	delete from public.production_bid_items where request_id = request.id;
	for entry in select x.e, x.ord from jsonb_array_elements(p_bids) with ordinality as x(e, ord) loop
		label := btrim(coalesce(entry.e ->> 'name', ''));
		if jsonb_typeof(coalesce(entry.e -> 'items', '[]'::jsonb)) <> 'array' then
			raise exception 'The rows of % are a list.', label using errcode = 'P0001';
		end if;
		bid := null;
		select p.bid_id into bid from public.request_packages p where p.request_id = request.id and p.key = entry.e ->> 'key';
		if bid is null then
			insert into public.production_bids (site_host, project_id, name, request_id)
				values (request.site_host, request.project_id, label, request.id)
				returning id into bid;
			insert into public.request_packages (request_id, site_host, project_id, key, name, position, bid_id)
				values (request.id, request.site_host, request.project_id, entry.e ->> 'key', label, entry.ord - 1, bid);
		else
			update public.production_bids set name = label where id = bid and request_id = request.id;
			update public.request_packages set name = label, position = entry.ord - 1
				where request_id = request.id and key = entry.e ->> 'key';
		end if;
		insert into public.production_bid_items (bid_id, site_host, project_id, request_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source, unit_count)
			select bid, request.site_host, request.project_id, request.id,
				i.item ->> 'kind', i.item ->> 'key', i.item ->> 'code', (i.ord - 1)::integer,
				i.item ->> 'fpt_type', (i.item ->> 'fpt_id')::bigint,
				coalesce(i.item -> 'fields', '{}'::jsonb), coalesce((i.item ->> 'omitted')::boolean, false),
				coalesce(i.item ->> 'source', 'fpt'), coalesce((i.item ->> 'unit_count')::integer, 1)
			from jsonb_array_elements(coalesce(entry.e -> 'items', '[]'::jsonb)) with ordinality as i(item, ord);
		perform public.sg_production_bid_counts(bid, request.site_host, request.project_id);
	end loop;

	-- The vendors.
	if p_vendors is null then
		return;
	end if;
	delete from public.invitations i
		where i.request_id = request.id and i.link_pending
			and not exists (select 1 from jsonb_array_elements(p_vendors) as v where v ->> 'id' = i.id::text);
	for entry in select v from jsonb_array_elements(p_vendors) as x(v) loop
		if exists (select 1 from public.invitations where id = (entry.v ->> 'id')::uuid and request_id = request.id) then
			update public.invitations set
				vendor_name = coalesce(entry.v ->> 'vendor_name', ''),
				contact_email = coalesce(entry.v ->> 'contact_email', ''),
				vendor_group_id = (entry.v ->> 'vendor_group_id')::bigint,
				details = coalesce(entry.v -> 'details', '{}'::jsonb),
				package_keys = case when jsonb_typeof(entry.v -> 'package_keys') = 'array'
					then array(select jsonb_array_elements_text(entry.v -> 'package_keys')) end
				where id = (entry.v ->> 'id')::uuid and request_id = request.id;
		else
			insert into public.invitations (id, request_id, site_host, project_id, vendor_name, contact_email, vendor_group_id,
				details, package_keys, token_hash, expires_at, link_pending)
			values ((entry.v ->> 'id')::uuid, request.id, request.site_host, request.project_id,
				coalesce(entry.v ->> 'vendor_name', ''), coalesce(entry.v ->> 'contact_email', ''), (entry.v ->> 'vendor_group_id')::bigint,
				coalesce(entry.v -> 'details', '{}'::jsonb),
				case when jsonb_typeof(entry.v -> 'package_keys') = 'array' then array(select jsonb_array_elements_text(entry.v -> 'package_keys')) end,
				entry.v ->> 'token_hash', (entry.v ->> 'expires_at')::timestamptz, true);
		end if;
	end loop;
end;
$$;

-- Issue a draft request, in one write. As in `20261127100000_one_page.sql`; each row's count is
-- copied with it, and a row with no code refuses the issue.
create or replace function public.sg_issue_request(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_links jsonb
) returns void
language plpgsql set search_path = '' as $$
declare
	request public.bid_requests;
	pkg record;
	empty text;
	half text;
	uncoded text;
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
	if jsonb_typeof(p_links) is distinct from 'array' then
		raise exception 'The links are a list.' using errcode = 'P0001';
	end if;

	select p.name into empty from public.request_packages p
		where p.request_id = request.id and p.bid_id is not null
			and not exists (select 1 from public.production_bid_items i where i.bid_id = p.bid_id)
		order by p.position limit 1;
	if empty is not null then
		raise exception '% holds no row. Add rows to it or delete it.', empty using errcode = 'P0001';
	end if;
	select p.name into uncoded from public.production_bid_items i
		join public.request_packages p on p.bid_id = i.bid_id and p.request_id = request.id
		where i.request_id = request.id and btrim(i.code) = ''
		order by p.position, i.position limit 1;
	if uncoded is not null then
		raise exception 'A row in % has no code. Type one, or remove the row.', uncoded using errcode = 'P0001';
	end if;
	select coalesce(nullif(btrim(i.vendor_name), ''), 'A vendor') into half from public.invitations i
		where i.request_id = request.id and i.link_pending
			and (btrim(i.vendor_name) = '' or i.contact_email !~ '^[^@\s]+@[^@\s]+$')
		order by i.created_at limit 1;
	if half is not null then
		raise exception '% needs a name and an email.', half using errcode = 'P0001';
	end if;

	for pkg in
		select p.key, p.bid_id from public.request_packages p
		where p.request_id = request.id and p.bid_id is not null order by p.position
	loop
		insert into public.request_items (request_id, site_host, project_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source, package_key, unit_count)
			select request.id, request.site_host, request.project_id, i.kind, i.key, i.code,
				start + (row_number() over (order by i.position))::integer - 1,
				i.fpt_type, i.fpt_id, i.fields, i.omitted, i.source, pkg.key, i.unit_count
			from public.production_bid_items i where i.bid_id = pkg.bid_id;
		get diagnostics n = row_count;
		start := start + n;
	end loop;
	update public.request_packages set bid_id = null where request_id = request.id and bid_id is not null;
	delete from public.production_bids where request_id = request.id;

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

-- Give breakdown rows their Flow PT row, all or none. As in `20261123100000_breakdown.sql`; a row
-- that stands for several refuses the whole call.
create or replace function public.sg_link_request_items(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_links jsonb
) returns setof public.request_items
language plpgsql set search_path = '' as $$
declare
	request_status text;
	link jsonb;
	item public.request_items;
begin
	select status into request_status from public.bid_requests
		where id = p_request_id and site_host = p_site_host and project_id = p_project_id
		for update;
	if not found then
		raise exception 'No request %.', p_request_id using errcode = 'P0002';
	end if;
	if request_status not in ('draft', 'issued') then
		raise exception 'Rows are matched to Flow PT before the award.' using errcode = 'P0001';
	end if;
	if jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) = 0 then
		raise exception 'Name the rows to link.' using errcode = 'P0001';
	end if;
	for link in select * from jsonb_array_elements(p_links) loop
		select * into item from public.request_items
			where request_id = p_request_id and kind = link ->> 'kind' and key = link ->> 'key'
			for update;
		if not found then
			raise exception 'The request has no % %.', link ->> 'kind', link ->> 'key' using errcode = 'P0002';
		end if;
		if item.source <> 'breakdown' or item.fpt_id is not null then
			raise exception '% is not a breakdown row waiting for its Flow PT row.', item.code using errcode = 'P0001';
		end if;
		if item.unit_count > 1 then
			raise exception '% stands for % %s. It is never linked to one.', item.code, item.unit_count, item.kind using errcode = 'P0001';
		end if;
		if (link ->> 'fpt_type') is distinct from (case item.kind when 'shot' then 'Shot' else 'Asset' end) then
			raise exception '% is a %. It links only to a Flow PT %.', item.code, item.kind,
				case item.kind when 'shot' then 'Shot' else 'Asset' end using errcode = 'P0001';
		end if;
		if exists (
			select 1 from public.request_items
			where request_id = p_request_id and fpt_type = link ->> 'fpt_type' and fpt_id = (link ->> 'fpt_id')::bigint
		) then
			raise exception '% % is already in the request.', link ->> 'fpt_type', link ->> 'fpt_id' using errcode = 'P0001';
		end if;
		update public.request_items set fpt_type = link ->> 'fpt_type', fpt_id = (link ->> 'fpt_id')::bigint
			where id = item.id;
	end loop;
	return query select * from public.request_items where request_id = p_request_id order by position;
end;
$$;

revoke all on function
	public.sg_production_bid_counts(uuid, text, bigint),
	public.sg_save_draft(uuid, text, bigint, jsonb, jsonb),
	public.sg_issue_request(uuid, text, bigint, jsonb),
	public.sg_link_request_items(uuid, text, bigint, jsonb)
	from public, anon, authenticated, service_role;
grant execute on function
	public.sg_production_bid_counts(uuid, text, bigint),
	public.sg_save_draft(uuid, text, bigint, jsonb, jsonb),
	public.sg_issue_request(uuid, text, bigint, jsonb),
	public.sg_link_request_items(uuid, text, bigint, jsonb)
	to service_role;
