-- sg-bids breakdown: a request item may come from a breakdown (a script or previs spreadsheet), with
-- no Flow PT Shot or Asset yet.
--
--   - `request_items.source`: `fpt` for a row picked from Flow PT, `breakdown` for a row pasted,
--     imported or typed. Absent from what a vendor reads.
--   - A breakdown row gets its Flow PT row later, by matching codes (`fpt_type`, `fpt_id`). On a
--     draft that is an ordinary save. On an issued request it is the one change the freeze allows,
--     through `sg_link_request_items`: a breakdown row with no Flow PT row gets one, once, and
--     nothing else on the row changes. `fpt_linked_at` says when. Nothing a vendor reads changes:
--     the Flow PT row is production's alone.
--
-- Idempotent: safe to apply again on a database that already has it.

alter table public.request_items add column if not exists source text not null default 'fpt';
alter table public.request_items add column if not exists fpt_linked_at timestamptz;

do $$
begin
	if not exists (select 1 from pg_constraint where conname = 'request_items_source') then
		alter table public.request_items add constraint request_items_source check (source in ('fpt', 'breakdown'));
	end if;
end;
$$;

-- The items of a request change only while it is a draft. Issued, a breakdown row with no Flow PT
-- row may get one, once, and nothing else on the row may change with it.
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

-- Replace a draft request's items, in order. A row's source travels with it.
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
	insert into public.request_items (request_id, site_host, project_id, kind, key, code, position, fpt_type, fpt_id, fields, omitted, source)
		select p_request_id, p_site_host, p_project_id,
			e.item ->> 'kind', e.item ->> 'key', e.item ->> 'code', (e.ord - 1)::integer,
			e.item ->> 'fpt_type', (e.item ->> 'fpt_id')::bigint,
			coalesce(e.item -> 'fields', '{}'::jsonb), coalesce((e.item ->> 'omitted')::boolean, false),
			coalesce(e.item ->> 'source', 'fpt')
		from jsonb_array_elements(p_items) with ordinality as e(item, ord);
	return query select * from public.request_items where request_id = p_request_id order by position;
end;
$$;

-- Give breakdown rows their Flow PT row, all or none, on a draft or an issued request. Each link is
-- `{kind, key, fpt_type, fpt_id}`. A row already linked, a row picked from Flow PT, a Flow PT row
-- already in the request, or a type that is not the row's kind refuses the whole call.
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
	public.sg_request_items_guard(),
	public.sg_save_request_items(uuid, text, bigint, jsonb),
	public.sg_link_request_items(uuid, text, bigint, jsonb)
	from public, anon, authenticated;
grant execute on function
	public.sg_save_request_items(uuid, text, bigint, jsonb),
	public.sg_link_request_items(uuid, text, bigint, jsonb)
	to service_role;
