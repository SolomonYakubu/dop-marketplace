-- Direct messages (single JSON document per pair)
-- Normalize pair as (user_lo, user_hi) with lexicographic order lower/upper

create table if not exists public.direct_chats (
  user_lo text not null,
  user_hi text not null,
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_lo, user_hi)
);

create index if not exists idx_direct_chats_messages_gin on public.direct_chats using gin (messages jsonb_path_ops);

create or replace function public.touch_direct_chats_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

drop trigger if exists trg_direct_chats_updated_at on public.direct_chats;
create trigger trg_direct_chats_updated_at
before update on public.direct_chats
for each row execute procedure public.touch_direct_chats_updated_at();

alter table public.direct_chats enable row level security;

drop policy if exists "Direct chat read" on public.direct_chats;
drop policy if exists "Direct chat upsert" on public.direct_chats;
drop policy if exists "Direct chat update" on public.direct_chats;
create policy "Direct chat read" on public.direct_chats for select using ( true );
create policy "Direct chat upsert" on public.direct_chats for insert with check ( true );
create policy "Direct chat update" on public.direct_chats for update using ( true ) with check ( true );

-- RPC to append
create or replace function public.append_direct_chat_message(p_user_lo text, p_user_hi text, p_message jsonb)
returns void as $$
begin
  loop
    update public.direct_chats
      set messages = messages || jsonb_build_array(p_message)
    where user_lo = p_user_lo and user_hi = p_user_hi;
    if found then return; end if;
    begin
      insert into public.direct_chats(user_lo, user_hi, messages)
      values (p_user_lo, p_user_hi, jsonb_build_array(p_message));
      return;
    exception when unique_violation then
    end;
  end loop;
end; $$ language plpgsql security definer;
