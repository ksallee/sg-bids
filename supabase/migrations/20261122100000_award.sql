-- sg-bids award: the request's awarded state, and the record of what was written to Flow PT.
--
-- Production publishes the chosen scenario to Flow PT from its own browser session, reads it back,
-- then records it here in one write (`sg_record_award`):
--   - `awards`: one row per item and bid line awarded, with its share, when, and the Flow PT Bid and
--     Bid Line ids written for it. Published again, the rows are replaced, never added to.
--   - `award_publications`: one per request. What was written to Flow PT, merged over every run,
--     enough to undo it: the Bids and Bid Lines created, the Groups added to each Shot and Asset,
--     the Attachments minted. Also the site's names, the options, who published, and the choice to
--     publish while the Vendor role could read Bid or Bid Line.
--   - the request goes from issued to awarded. An award row locks the rates (`sg_bid_rates_guard`).
-- A run that stopped part way is recorded as `partial` with what landed, and changes no award row.
-- The undo (`sg_clear_award`) removes both, the request goes back to issued, the rates unlock.
-- An undo that stopped part way keeps the record with what is still in Flow PT.
--
-- Idempotent: safe to apply again on a database that already has it.

alter table public.bid_requests drop constraint if exists bid_requests_status_check;
alter table public.bid_requests
	add constraint bid_requests_status_check check (status in ('draft', 'issued', 'awarded', 'closed'));

alter table public.awards add column if not exists fpt_bid_id bigint check (fpt_bid_id > 0);
alter table public.awards add column if not exists fpt_line_id bigint check (fpt_line_id > 0);

create table if not exists public.award_publications (
	id uuid primary key default gen_random_uuid(),
	request_id uuid not null,
	site_host text not null,
	project_id bigint not null,
	scenario_id uuid,
	state text not null check (state in ('published', 'partial', 'undo_partial')),
	site jsonb not null check (jsonb_typeof(site) = 'object'),
	written jsonb not null check (jsonb_typeof(written) = 'object'),
	options jsonb not null default '{}' check (jsonb_typeof(options) = 'object'),
	problems jsonb not null default '[]' check (jsonb_typeof(problems) = 'array'),
	error text check (length(error) <= 2000),
	exposure jsonb check (exposure is null or jsonb_typeof(exposure) = 'object'),
	summary jsonb not null default '{}' check (jsonb_typeof(summary) = 'object'),
	published_by jsonb not null check (jsonb_typeof(published_by) = 'object'),
	published_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint award_publications_one unique (request_id),
	constraint award_publications_request foreign key (request_id, site_host, project_id)
		references public.bid_requests (id, site_host, project_id) on delete cascade
);

-- A draft request changes freely. Issued, it is frozen but for its due day, the award and closing.
-- Awarded needs an award row; back to issued needs none.
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

-- Record a run of the award, in the caller's tenant. `published` replaces the award rows and marks
-- the request awarded. `partial` keeps what landed and changes no award row.
create or replace function public.sg_record_award(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_state text, p_scenario_id uuid,
	p_awards jsonb, p_publication jsonb
) returns void
language plpgsql set search_path = '' as $$
declare
	request_status text;
begin
	select status into request_status from public.bid_requests
		where id = p_request_id and site_host = p_site_host and project_id = p_project_id
		for update;
	if not found then
		raise exception 'No request %.', p_request_id using errcode = 'P0002';
	end if;
	if request_status not in ('issued', 'awarded') then
		raise exception 'Only an issued request is awarded.' using errcode = 'P0001';
	end if;
	if p_state not in ('published', 'partial') then
		raise exception 'A run is published or partial.' using errcode = 'P0001';
	end if;
	if jsonb_typeof(p_awards) <> 'array' or jsonb_typeof(p_publication) <> 'object' then
		raise exception 'The award rows are a list and the record an object.' using errcode = 'P0001';
	end if;
	if p_scenario_id is not null and not exists (
		select 1 from public.award_scenarios
		where id = p_scenario_id and request_id = p_request_id and chosen
	) then
		raise exception 'Publish the chosen scenario.' using errcode = 'P0001';
	end if;

	insert into public.award_publications as p (request_id, site_host, project_id, scenario_id, state, site, written,
		options, problems, error, exposure, summary, published_by)
	values (p_request_id, p_site_host, p_project_id, p_scenario_id, p_state, p_publication -> 'site',
		p_publication -> 'written', coalesce(p_publication -> 'options', '{}'), coalesce(p_publication -> 'problems', '[]'),
		p_publication ->> 'error', case when jsonb_typeof(p_publication -> 'exposure') = 'object' then p_publication -> 'exposure' end,
		coalesce(p_publication -> 'summary', '{}'), p_publication -> 'published_by')
	on conflict (request_id) do update set
		scenario_id = excluded.scenario_id, state = excluded.state, site = excluded.site, written = excluded.written,
		options = excluded.options, problems = excluded.problems, error = excluded.error, exposure = excluded.exposure,
		summary = excluded.summary, published_by = excluded.published_by, published_at = now(), updated_at = now();

	if p_state = 'partial' then
		return;
	end if;

	if exists (
		select 1 from jsonb_array_elements(p_awards) as e
		left join public.bid_lines l on l.id = (e ->> 'bid_line_id')::uuid and l.request_id = p_request_id
		left join public.bids b on b.id = l.bid_id and b.status = 'submitted'
		where b.id is null
	) then
		raise exception 'An award names a line of a submitted bid of this request.' using errcode = 'P0001';
	end if;

	delete from public.awards where request_id = p_request_id;
	insert into public.awards (request_id, site_host, project_id, item_kind, item_key, bid_line_id, share_percent,
		written_to_fpt_at, fpt_bid_id, fpt_line_id)
	select p_request_id, p_site_host, p_project_id, a.item_kind, a.item_key, a.bid_line_id, a.share_percent,
		now(), a.fpt_bid_id, a.fpt_line_id
	from jsonb_to_recordset(p_awards) as a(item_kind text, item_key text, bid_line_id uuid, share_percent text,
		fpt_bid_id bigint, fpt_line_id bigint);
	if not exists (select 1 from public.awards where request_id = p_request_id) then
		raise exception 'An award awards something.' using errcode = 'P0001';
	end if;
	update public.bid_requests set status = 'awarded' where id = p_request_id and status = 'issued';
end;
$$;

-- After an undo. Nothing left in Flow PT (`p_remaining` null): the award rows and the record go, the
-- request is issued again, the rates unlock. Something left: the record keeps it, with the error.
create or replace function public.sg_clear_award(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_remaining jsonb, p_error text
) returns void
language plpgsql set search_path = '' as $$
begin
	perform 1 from public.bid_requests
		where id = p_request_id and site_host = p_site_host and project_id = p_project_id
		for update;
	if not found then
		raise exception 'No request %.', p_request_id using errcode = 'P0002';
	end if;
	if p_remaining is not null then
		if jsonb_typeof(p_remaining) <> 'object' then
			raise exception 'What is left is an object.' using errcode = 'P0001';
		end if;
		update public.award_publications set state = 'undo_partial', written = p_remaining, error = left(p_error, 2000),
			updated_at = now()
			where request_id = p_request_id;
		if not found then
			raise exception 'No award to undo.' using errcode = 'P0002';
		end if;
		return;
	end if;
	delete from public.awards where request_id = p_request_id;
	delete from public.award_publications where request_id = p_request_id;
	update public.bid_requests set status = 'issued' where id = p_request_id and status = 'awarded';
end;
$$;

alter table public.award_publications enable row level security;

revoke all on table public.award_publications from anon, authenticated;
grant select, insert, update, delete on table public.award_publications to service_role;

revoke all on function
	public.sg_bid_requests_guard(),
	public.sg_record_award(uuid, text, bigint, text, uuid, jsonb, jsonb),
	public.sg_clear_award(uuid, text, bigint, jsonb, text)
	from public, anon, authenticated;
grant execute on function
	public.sg_record_award(uuid, text, bigint, text, uuid, jsonb, jsonb),
	public.sg_clear_award(uuid, text, bigint, jsonb, text)
	to service_role;
