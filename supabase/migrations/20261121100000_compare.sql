-- sg-bids comparison: production's exchange rate per bid, and the chosen award scenario.
--
-- A vendor bids in its own currency and gives no rate; a submitted bid is frozen. Production sets
-- the rate to the request's base currency afterwards, so it lives in its own table, one row per
-- bid: each bid has its own date, and a vendor's second version may come weeks after the first.
-- A rate changes until the award; once the request has an award row, or is closed, it is locked.
--
-- An award scenario gains `chosen` (one per request at most) and `costs_left_out`: the bids whose
-- non-shot costs the scenario does not count. By default every vendor's costs count.
--
-- Idempotent: safe to apply again on a database that already has it.

create table if not exists public.bid_rates (
	id uuid primary key default gen_random_uuid(),
	bid_id uuid not null,
	request_id uuid not null,
	site_host text not null,
	project_id bigint not null,
	-- One unit of the bid currency in the base currency, as typed. Never a float.
	rate text not null check (rate ~ '^[0-9]+(\.[0-9]+)?$' and rate !~ '^0+(\.0+)?$'),
	rate_date date not null,
	set_at timestamptz not null default now(),
	constraint bid_rates_one_per_bid unique (bid_id),
	constraint bid_rates_bid foreign key (bid_id, request_id)
		references public.bids (id, request_id) on delete cascade,
	constraint bid_rates_request foreign key (request_id, site_host, project_id)
		references public.bid_requests (id, site_host, project_id) on delete cascade
);

create index if not exists bid_rates_request on public.bid_rates (request_id);

alter table public.award_scenarios add column if not exists chosen boolean not null default false;
alter table public.award_scenarios add column if not exists costs_left_out jsonb not null default '[]';

do $$
begin
	if not exists (select 1 from pg_constraint where conname = 'award_scenarios_costs_left_out') then
		alter table public.award_scenarios
			add constraint award_scenarios_costs_left_out check (jsonb_typeof(costs_left_out) = 'array');
	end if;
end;
$$;

create unique index if not exists award_scenarios_one_chosen on public.award_scenarios (request_id) where chosen;

-- A rate is production's, on a bid it can see, in another currency than the base, until the award.
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

create or replace trigger bid_rates_guard before insert or update or delete on public.bid_rates
	for each row execute function public.sg_bid_rates_guard();

-- Set or clear the rate of a bid, in the caller's tenant. A null rate clears it.
create or replace function public.sg_set_bid_rate(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_bid_id uuid, p_rate text, p_rate_date date
) returns void
language plpgsql set search_path = '' as $$
begin
	perform 1 from public.bids
		where id = p_bid_id and request_id = p_request_id and site_host = p_site_host and project_id = p_project_id
			and status <> 'draft';
	if not found then
		raise exception 'No bid %.', p_bid_id using errcode = 'P0002';
	end if;
	if p_rate is null then
		delete from public.bid_rates where bid_id = p_bid_id;
		return;
	end if;
	insert into public.bid_rates (bid_id, request_id, site_host, project_id, rate, rate_date)
		values (p_bid_id, p_request_id, p_site_host, p_project_id, p_rate, p_rate_date)
		on conflict (bid_id) do update set rate = excluded.rate, rate_date = excluded.rate_date;
end;
$$;

-- Save a scenario with the bids whose non-shot costs it leaves out, in one write.
create or replace function public.sg_save_award_scenario(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_scenario_id uuid, p_name text, p_items jsonb,
	p_costs_left_out jsonb
) returns uuid
language plpgsql set search_path = '' as $$
declare
	scenario uuid;
begin
	if jsonb_typeof(p_costs_left_out) <> 'array' then
		raise exception 'The costs left out are a list of bids.' using errcode = 'P0001';
	end if;
	if exists (
		select 1 from jsonb_array_elements_text(p_costs_left_out) as e(id)
		left join public.bids b on b.id::text = e.id and b.request_id = p_request_id and b.status <> 'draft'
		where b.id is null
	) then
		raise exception 'A scenario leaves out the costs of its request''s bids only.' using errcode = 'P0001';
	end if;
	scenario := public.sg_save_scenario(p_request_id, p_site_host, p_project_id, p_scenario_id, p_name, p_items);
	update public.award_scenarios set costs_left_out = p_costs_left_out where id = scenario;
	return scenario;
end;
$$;

-- Mark one scenario of a request as the chosen one, or none with a null id.
create or replace function public.sg_choose_scenario(
	p_request_id uuid, p_site_host text, p_project_id bigint, p_scenario_id uuid
) returns void
language plpgsql set search_path = '' as $$
begin
	perform 1 from public.bid_requests
		where id = p_request_id and site_host = p_site_host and project_id = p_project_id
		for update;
	if not found then
		raise exception 'No request %.', p_request_id using errcode = 'P0002';
	end if;
	update public.award_scenarios set chosen = false
		where request_id = p_request_id and site_host = p_site_host and project_id = p_project_id and chosen
			and id is distinct from p_scenario_id;
	if p_scenario_id is not null then
		update public.award_scenarios set chosen = true
			where id = p_scenario_id and request_id = p_request_id and site_host = p_site_host and project_id = p_project_id;
		if not found then
			raise exception 'No scenario %.', p_scenario_id using errcode = 'P0002';
		end if;
	end if;
end;
$$;

alter table public.bid_rates enable row level security;

revoke all on table public.bid_rates from anon, authenticated;
grant select, insert, update, delete on table public.bid_rates to service_role;

revoke all on function
	public.sg_bid_rates_guard(),
	public.sg_set_bid_rate(uuid, text, bigint, uuid, text, date),
	public.sg_save_award_scenario(uuid, text, bigint, uuid, text, jsonb, jsonb),
	public.sg_choose_scenario(uuid, text, bigint, uuid)
	from public, anon, authenticated;
grant execute on function
	public.sg_set_bid_rate(uuid, text, bigint, uuid, text, date),
	public.sg_save_award_scenario(uuid, text, bigint, uuid, text, jsonb, jsonb),
	public.sg_choose_scenario(uuid, text, bigint, uuid)
	to service_role;
