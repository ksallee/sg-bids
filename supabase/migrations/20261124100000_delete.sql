-- sg-bids delete: a whole request goes, draft or issued, in one transaction.
--
-- The freezes stay as they are: no statement may delete an issued request, its items, a submitted
-- bid, its lines, or a locked rate. `sg_delete_request` is the one way past them. It finds the
-- request in the caller's tenant and locks it, refuses while an award is in Flow PT (an
-- `award_publications` row, published, partial or part undone, or an award row), then sets a
-- transaction local setting, `sg.delete_request`, to the request's id. Each freeze trigger lets a
-- DELETE through when the row's request is that id, and nothing else: an update or an insert is
-- refused as before, and a row of another request is refused as before. The function clears the
-- setting before it returns, and a failure rolls it back with everything else.
--
-- Who can set it: a SQL session. The server reaches the database only through PostgREST, which
-- calls the functions of `public` and sets no setting a client names, and each call is its own
-- transaction. A role with a SQL session can drop the triggers anyway.
--
-- The link tokens of the request's invitations, the live one and the former ones, are kept as
-- hashes in `withdrawn_links`, so a vendor who opens a dead link is told the production withdrew
-- the request. Nothing else of the request is kept: no tenant, no code, no name.
--
-- Deleting never writes to Flow PT.
--
-- Idempotent: safe to apply again on a database that already has it.

create table if not exists public.withdrawn_links (
	id uuid primary key default gen_random_uuid(),
	token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
	withdrawn_at timestamptz not null default now(),
	constraint withdrawn_links_token_hash unique (token_hash)
);

alter table public.withdrawn_links enable row level security;
revoke all on table public.withdrawn_links from anon, authenticated;
grant select, insert, update, delete on table public.withdrawn_links to service_role;

-- A draft request changes freely. Issued, it is frozen but for its due day, the award and closing.
-- Awarded needs an award row; back to issued needs none. Deleted only whole, by `sg_delete_request`.
create or replace function public.sg_bid_requests_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
	if tg_op = 'DELETE' then
		if old.status <> 'draft' and current_setting('sg.delete_request', true) is distinct from old.id::text then
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
		if new.status in ('closed', 'awarded') then
			raise exception 'A draft is issued first.' using errcode = 'P0001';
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
	if new.status = 'awarded' and old.status <> 'awarded'
		and not exists (select 1 from public.awards where request_id = old.id) then
		raise exception 'A request is awarded with its award rows.' using errcode = 'P0001';
	end if;
	if old.status = 'awarded' and new.status = 'issued'
		and exists (select 1 from public.awards where request_id = old.id) then
		raise exception 'Undo the award before the request goes back to issued.' using errcode = 'P0001';
	end if;
	if old.status in ('issued', 'awarded') and new.status = 'closed' then
		new.closed_at := now();
	elsif new.closed_at is distinct from old.closed_at then
		raise exception 'An issued request is frozen. A change is a new round.' using errcode = 'P0001';
	end if;
	return new;
end;
$$;

-- The items of a request change only while it is a draft. Issued, a breakdown row with no Flow PT
-- row may get one, once, and nothing else on the row may change with it. They go with their
-- request, by `sg_delete_request`.
create or replace function public.sg_request_items_guard() returns trigger
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
		if tg_op = 'UPDATE'
			and old.source = 'breakdown'
			and old.fpt_type is null and old.fpt_id is null
			and new.fpt_id is not null
			and new.fpt_type = (case old.kind when 'shot' then 'Shot' when 'asset' then 'Asset' end)
			and (to_jsonb(new) - array['fpt_type', 'fpt_id', 'fpt_linked_at'])
				= (to_jsonb(old) - array['fpt_type', 'fpt_id', 'fpt_linked_at'])
			and exists (select 1 from public.bid_requests where id = old.request_id and status = 'issued') then
			new.fpt_linked_at := now();
			return new;
		end if;
		raise exception 'The items of an issued request are frozen. A change is a new round.' using errcode = 'P0001';
	end if;
	if tg_op = 'DELETE' then
		return old;
	end if;
	return new;
end;
$$;

-- A draft bid changes while its invitation is live and its request is issued. A submitted bid is
-- final: the one move left is to withdraw it. It goes with its request, by `sg_delete_request`.
create or replace function public.sg_bids_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
	live boolean;
	request_status text;
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

-- The lines of a bid change only while it is a draft. They go with their request, by
-- `sg_delete_request`.
create or replace function public.sg_bid_lines_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
	ids uuid[];
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
	return new;
end;
$$;

-- A rate is production's, on a bid it can see, in another currency than the base, until the award.
-- It goes with its request, by `sg_delete_request`.
create or replace function public.sg_bid_rates_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
	rid uuid;
	bid_currency text;
	bid_status text;
	base text;
	request_status text;
begin
	rid := case when tg_op = 'DELETE' then old.request_id else new.request_id end;
	if tg_op = 'DELETE' and current_setting('sg.delete_request', true) = rid::text then
		return old;
	end if;
	if tg_op = 'UPDATE' and (new.bid_id <> old.bid_id or new.request_id <> old.request_id
		or new.site_host <> old.site_host or new.project_id <> old.project_id) then
		raise exception 'A rate cannot move to another bid.' using errcode = 'P0001';
	end if;
	select r.status into request_status from public.bid_requests r where r.id = rid;
	-- A cascade from a deleted request finds no parent.
	if request_status is null then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	if request_status = 'closed' or exists (select 1 from public.awards a where a.request_id = rid) then
		raise exception 'The award is made. The rates are locked.' using errcode = 'P0001';
	end if;
	if tg_op = 'DELETE' then
		return old;
	end if;
	select b.currency, b.status, r.base_currency into bid_currency, bid_status, base
		from public.bids b join public.bid_requests r on r.id = b.request_id
		where b.id = new.bid_id;
	if bid_status = 'draft' then
		raise exception 'A draft bid is the vendor''s.' using errcode = 'P0001';
	end if;
	if bid_currency = base then
		raise exception 'The bid is in the base currency. It takes no rate.' using errcode = 'P0001';
	end if;
	new.set_at := now();
	return new;
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
	delete from public.bid_requests where id = request.id;
	get diagnostics n = row_count;
	if n <> 1 then
		raise exception 'The request did not delete.' using errcode = 'P0001';
	end if;

	perform set_config('sg.delete_request', '', true);
	return gone;
end;
$$;

revoke all on function
	public.sg_bid_requests_guard(), public.sg_request_items_guard(), public.sg_bids_guard(),
	public.sg_bid_lines_guard(), public.sg_bid_rates_guard(),
	public.sg_delete_request(uuid, text, bigint)
	from public, anon, authenticated;
grant execute on function public.sg_delete_request(uuid, text, bigint) to service_role;
