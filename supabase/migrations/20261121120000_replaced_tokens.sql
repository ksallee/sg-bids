-- The hashes of an invitation's former link tokens, so a vendor whose link production replaced is
-- told so (410), while a cookie that names an invitation with any other token learns nothing of
-- it (401). Only hashes, as for the live token; the last ten are kept.
--
-- A trigger keeps the list, so every path that changes `token_hash` records the old one.
--
-- Idempotent: safe to apply again.

alter table public.invitations
	add column if not exists replaced_token_hashes text[] not null default '{}'
	check (array_position(replaced_token_hashes, null) is null and cardinality(replaced_token_hashes) <= 10);

create or replace function public.sg_invitations_replaced_tokens() returns trigger
language plpgsql set search_path = '' as $$
begin
	if new.token_hash is distinct from old.token_hash then
		new.replaced_token_hashes := (array_append(old.replaced_token_hashes, old.token_hash))[
			greatest(1, cardinality(old.replaced_token_hashes) - 8):
		];
	end if;
	return new;
end;
$$;

create or replace trigger invitations_replaced_tokens before update on public.invitations
	for each row execute function public.sg_invitations_replaced_tokens();

revoke all on function public.sg_invitations_replaced_tokens() from public, anon, authenticated;
