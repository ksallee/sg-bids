-- sg-bids one page: a request owns its bids again. A request is made, filled and issued on one page:
-- its bids, their rows, its vendors and its details.
--
--   - `production_bids.request_id`: the draft request a bid belongs to. A bid is added, renamed and
--     deleted on its request's page and has no life of its own. Its rows stay in
--     `production_bid_items`, which carries the request too, so a row sits in one bid of a request
--     (`production_bid_items_one_bid`). A request's package names its bid in `bid_id`, as before.
--   - `sg_save_draft`: a draft's bids, their rows and its vendors, in one write. A bid left out goes
--     with its rows; a vendor added to the draft and left out goes.
--   - `invitations`: a vendor added to a draft is kept as it is typed, a name or an email still
--     missing. The issue refuses it until both are there.
--   - `sg_issue_request`: each bid's rows copied under its package and frozen, as before. A bid with
--     no row, or a vendor without a name or an email, refuses it. Then the draft's bids go: the
--     request holds the rows now.
--   - `sg_delete_request`: a draft's rows are counted from its bids, and its bids go with it. It
--     answers the request's name beside its code, and keeps no placeholder hash of a vendor whose
--     link was never made.
--   - The functions of the Bids page go: `sg_save_production_bid`, `sg_clone_production_bid`,
--     `sg_move_bid_rows`, `sg_delete_production_bid`, `sg_set_request_bids`, `sg_free_bid_name`,
--     `sg_bids_first_convert`, and `sg_save_request_items`, the save of a draft's own rows.
--
-- Existing data (`sg_one_page_convert`, run here, idempotent). No row is lost and none changes:
--   - An issued request is not touched. Its packages forget the bid they came from.
--   - A draft owns the bids it names. A bid named by several drafts is copied into each after the
--     first. A row two bids of one draft hold stays in the first; the issue refused such a draft.
--   - A bid no draft names becomes a draft request of its own, named after it, with its rows.
--
-- Idempotent: safe to apply again.

alter table public.production_bids add column if not exists request_id uuid;
alter table public.production_bid_items add column if not exists request_id uuid;

do $$
begin
	if not exists (select 1 from pg_constraint where conname = 'production_bids_request') then
		alter table public.production_bids add constraint production_bids_request foreign key (request_id, site_host, project_id)
			references public.bid_requests (id, site_host, project_id) on delete cascade;
	end if;
	if not exists (select 1 from pg_constraint where conname = 'production_bids_request_key') then
		alter table public.production_bids add constraint production_bids_request_key unique (id, request_id);
	end if;
	if not exists (select 1 from pg_constraint where conname = 'production_bid_items_request') then
		alter table public.production_bid_items add constraint production_bid_items_request foreign key (bid_id, request_id)
			references public.production_bids (id, request_id) on update cascade;
	end if;
	-- A vendor added to a draft is kept as typed. The issue holds it to a name and an email.
	alter table public.invitations drop constraint if exists invitations_vendor_name_check;
	alter table public.invitations drop constraint if exists invitations_contact_email_check;
	if not exists (select 1 from pg_constraint where conname = 'invitations_vendor_name') then
		alter table public.invitations add constraint invitations_vendor_name
			check (length(vendor_name) <= 200 and (link_pending or length(btrim(vendor_name)) >= 1));
	end if;
	if not exists (select 1 from pg_constraint where conname = 'invitations_contact_email') then
		alter table public.invitations add constraint invitations_contact_email
			check (length(contact_email) <= 320 and (link_pending or contact_email ~ '^[^@\s]+@[^@\s]+$'));
	end if;
end;
$$;

create index if not exists production_bids_request_id on public.production_bids (request_id) where request_id is not null;
create unique index if not exists production_bid_items_one_bid on public.production_bid_items (request_id, kind, key) where request_id is not null;

-- A draft's bids, in order, and its vendors, in one write in the caller's tenant.
--   `p_bids`: `[{key, name, items}]`. A key the draft holds keeps its bid, renamed and moved; a new
--   key adds a bid; a bid left out goes with its rows. Each item is a request item's columns
--   without the package. A row sits in one bid of the request.
--   `p_vendors`: `[{id, vendor_name, contact_email, vendor_group_id, details, package_keys,
--   token_hash, expires_at}]`, or null to leave the vendors as they are. An id the draft holds is
--   updated; a new one is a vendor added to the draft, its link made at the issue (`token_hash` a
--   placeholder no token opens). A vendor added to the draft and left out goes. A vendor whose link
--   was made before stays. Every vendor loses the bids taken out; left with none, it is invited to
--   every bid.
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
		insert into public.production_bid_items (bid_id, site_host, project_id, request_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source)
			select bid, request.site_host, request.project_id, request.id,
				i.item ->> 'kind', i.item ->> 'key', i.item ->> 'code', (i.ord - 1)::integer,
				i.item ->> 'fpt_type', (i.item ->> 'fpt_id')::bigint,
				coalesce(i.item -> 'fields', '{}'::jsonb), coalesce((i.item ->> 'omitted')::boolean, false),
				coalesce(i.item ->> 'source', 'fpt')
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

-- Issue a draft request, in the caller's tenant, in one write. Each bid's rows are copied as they are
-- now into the request under its package; a bid with no row, or a vendor added to the draft without
-- a name or an email, refuses the issue. Each vendor added to the draft gets its link now:
-- `p_links` is `[{invitation_id, token_hash, expires_at}]`, one per such vendor, no more, no fewer.
-- Then the draft's bids go, and the request is issued and freezes (`sg_bid_requests_guard`).
create or replace function public.sg_issue_request(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_links jsonb
) returns void
language plpgsql set search_path = '' as $$
declare
	request public.bid_requests;
	pkg record;
	empty text;
	half text;
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
		insert into public.request_items (request_id, site_host, project_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source, package_key)
			select request.id, request.site_host, request.project_id, i.kind, i.key, i.code,
				start + (row_number() over (order by i.position))::integer - 1,
				i.fpt_type, i.fpt_id, i.fields, i.omitted, i.source, pkg.key
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

-- Delete a request and everything under it, in the caller's tenant: draft, issued, awarded and
-- undone, or closed. Refused while an award is in Flow PT. Answers what went, counted: a draft's rows
-- are its bids'.
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
		where i.request_id = request.id and not i.link_pending
		on conflict (token_hash) do nothing;

	gone := jsonb_build_object('code', request.code, 'title', nullif(btrim(request.header ->> 'title'), ''), 'round', request.round, 'status', request.status);
	select jsonb_build_object(
		'invitations', (select count(*) from public.invitations where request_id = request.id),
		'bids', (select count(*) from public.bids where request_id = request.id and status <> 'draft'),
		'drafts', (select count(*) from public.bids where request_id = request.id and status = 'draft'),
		'lines', (select count(*) from public.bid_lines where request_id = request.id),
		'scenarios', (select count(*) from public.award_scenarios where request_id = request.id),
		'rates', (select count(*) from public.bid_rates where request_id = request.id),
		'items', (select count(*) from public.request_items where request_id = request.id)
			+ (select count(*) from public.production_bid_items where request_id = request.id)
	) || gone into gone;

	delete from public.award_scenario_items where request_id = request.id;
	delete from public.award_scenarios where request_id = request.id;
	delete from public.bid_rates where request_id = request.id;
	delete from public.bid_lines where request_id = request.id;
	delete from public.bids where request_id = request.id;
	delete from public.invitations where request_id = request.id;
	delete from public.request_items where request_id = request.id;
	delete from public.request_packages where request_id = request.id;
	delete from public.production_bids where request_id = request.id;
	delete from public.bid_requests where id = request.id;
	get diagnostics n = row_count;
	if n <> 1 then
		raise exception 'The request did not delete.' using errcode = 'P0001';
	end if;

	perform set_config('sg.delete_request', '', true);
	return gone;
end;
$$;

-- The data from before: every bid ends up owned by one draft request, and nothing is lost.
--   1. An issued request keeps its rows; its packages forget the bid they came from.
--   2. Each draft owns the bids it names: the first draft (oldest) takes a bid, every later one gets
--      a copy with every row. A row an earlier bid of the same draft holds stays there alone.
--   3. A bid no draft names becomes a draft request of its own: named after it, round 1, the
--      project's name from its latest request, base currency USD, a code made from the bid's id.
-- Answers what it did: `{owned, copied, made, dropped}`, `dropped` the rows two bids of one draft
-- held. Applied again it answers zeros.
create or replace function public.sg_one_page_convert() returns jsonb
language plpgsql set search_path = '' as $$
declare
	p record;
	b public.production_bids;
	target uuid;
	r public.bid_requests;
	made_code text;
	found_project text;
	n integer;
	dropped integer := 0;
	owned integer := 0;
	copied integer := 0;
	made integer := 0;
begin
	update public.request_packages x set bid_id = null
		from public.bid_requests q
		where q.id = x.request_id and q.status <> 'draft' and x.bid_id is not null;

	for p in
		select x.id, x.request_id, x.bid_id, q.site_host, q.project_id
		from public.request_packages x
		join public.bid_requests q on q.id = x.request_id and q.status = 'draft'
		join public.production_bids pb on pb.id = x.bid_id
		where pb.request_id is distinct from x.request_id
		order by q.created_at, q.id, x.position, x.id
	loop
		select * into b from public.production_bids where id = p.bid_id;
		if b.request_id is null then
			update public.production_bids set request_id = p.request_id where id = b.id;
			target := b.id;
			owned := owned + 1;
		else
			insert into public.production_bids (site_host, project_id, name, request_id, created_at)
				values (b.site_host, b.project_id, b.name, p.request_id, b.created_at)
				returning id into target;
			insert into public.production_bid_items (bid_id, site_host, project_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source)
				select target, i.site_host, i.project_id, i.kind, i.key, i.code, i.position, i.fpt_type, i.fpt_id, i.fields, i.omitted, i.source
				from public.production_bid_items i where i.bid_id = b.id;
			update public.request_packages set bid_id = target where id = p.id;
			copied := copied + 1;
		end if;
		delete from public.production_bid_items i
			where i.bid_id = target and i.request_id is distinct from p.request_id
				and exists (
					select 1 from public.production_bid_items o
					where o.request_id = p.request_id and o.kind = i.kind and o.key = i.key
				);
		get diagnostics n = row_count;
		dropped := dropped + n;
		update public.production_bid_items set request_id = p.request_id where bid_id = target;
		perform public.sg_production_bid_counts(target, p.site_host, p.project_id);
	end loop;

	for b in select * from public.production_bids where request_id is null order by created_at, id loop
		select q.header ->> 'project' into found_project from public.bid_requests q
			where q.site_host = b.site_host and q.project_id = b.project_id and nullif(btrim(q.header ->> 'project'), '') is not null
			order by q.created_at desc limit 1;
		n := 1;
		loop
			made_code := 'BID-' || upper(left(replace(b.id::text, '-', ''), 8)) || case when n > 1 then '-' || n else '' end;
			exit when not exists (
				select 1 from public.bid_requests q
				where q.site_host = b.site_host and q.project_id = b.project_id and q.code = made_code and q.round = 1
			);
			n := n + 1;
		end loop;
		insert into public.bid_requests (site_host, project_id, code, round, status, base_currency, header, created_at)
			values (b.site_host, b.project_id, made_code, 1, 'draft', 'USD',
				jsonb_build_object('title', b.name, 'project', coalesce(found_project, 'Project ' || b.project_id), 'assumptions', '[]'::jsonb),
				b.created_at)
			returning * into r;
		update public.production_bids set request_id = r.id where id = b.id;
		update public.production_bid_items set request_id = r.id where bid_id = b.id;
		insert into public.request_packages (request_id, site_host, project_id, key, name, position, bid_id)
			values (r.id, r.site_host, r.project_id, 'bid:' || b.id, b.name, 0, b.id);
		made := made + 1;
	end loop;

	return jsonb_build_object('owned', owned, 'copied', copied, 'made', made, 'dropped', dropped);
end;
$$;

select public.sg_one_page_convert();

drop function if exists public.sg_save_production_bid(uuid, text, bigint, text, jsonb);
drop function if exists public.sg_clone_production_bid(uuid, text, bigint);
drop function if exists public.sg_move_bid_rows(uuid, uuid, text, bigint, jsonb, boolean);
drop function if exists public.sg_delete_production_bid(uuid, text, bigint);
drop function if exists public.sg_set_request_bids(uuid, text, bigint, jsonb);
drop function if exists public.sg_free_bid_name(text, bigint, text);
drop function if exists public.sg_bids_first_convert();
drop function if exists public.sg_save_request_items(uuid, text, bigint, jsonb);
drop function if exists public.sg_save_request_items(uuid, text, bigint, jsonb, jsonb);

revoke all on function
	public.sg_save_draft(uuid, text, bigint, jsonb, jsonb),
	public.sg_issue_request(uuid, text, bigint, jsonb),
	public.sg_delete_request(uuid, text, bigint),
	public.sg_one_page_convert()
	from public, anon, authenticated, service_role;
grant execute on function
	public.sg_save_draft(uuid, text, bigint, jsonb, jsonb),
	public.sg_issue_request(uuid, text, bigint, jsonb),
	public.sg_delete_request(uuid, text, bigint)
	to service_role;
