-- NEW IMPLEMENTATION (single JSON document per offer)
-- One row per offer. All messages stored in a JSONB array for simpler realtime subscription + attachment support.
-- Each message object shape (client-enforced):
-- {
--   "id": "uuid",
--   "sender": "0x... (lowercase)",
--   "content": "text content (optional if attachments present)",
--   "attachments": ["ipfs://...", ...], -- optional array of URIs
--   "created_at": "ISO timestamp",
--   "message_type": "text|image|mixed" -- optional
-- }

-- 1. Table (document store)
create table if not exists public.offer_chats (
  offer_id bigint primary key,
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2. GIN index for potential containment queries (optional)
create index if not exists idx_offer_chats_messages_gin on public.offer_chats using gin (messages jsonb_path_ops);

-- 3. Trigger to bump updated_at
create or replace function public.touch_offer_chats_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

drop trigger if exists trg_offer_chats_updated_at on public.offer_chats;
create trigger trg_offer_chats_updated_at
before update on public.offer_chats
for each row execute procedure public.touch_offer_chats_updated_at();

-- 4. Enable RLS
alter table public.offer_chats enable row level security;

-- 5. Policies (TEMP permissive; tighten later)
-- NOTE: CREATE POLICY does not support IF NOT EXISTS; use drop/create idempotently.
drop policy if exists "Offer chat read" on public.offer_chats;
drop policy if exists "Offer chat upsert" on public.offer_chats;
drop policy if exists "Offer chat update" on public.offer_chats;
create policy "Offer chat read" on public.offer_chats for select using ( true );
create policy "Offer chat upsert" on public.offer_chats for insert with check ( true );
create policy "Offer chat update" on public.offer_chats for update using ( true ) with check ( true );

-- 6. (Optional) RPC to append a message atomically (safer than client read-modify-write)
-- Call with: select public.append_offer_chat_message(offer_id, '{"id":"...","sender":"..."}'::jsonb);
create or replace function public.append_offer_chat_message(p_offer_id bigint, p_message jsonb)
returns void as $$
begin
  loop
    -- Try update existing
    update public.offer_chats
      set messages = messages || jsonb_build_array(p_message)
    where offer_id = p_offer_id;
    if found then
      return;
    end if;
    -- Not found: attempt insert
    begin
      insert into public.offer_chats (offer_id, messages)
      values (p_offer_id, jsonb_build_array(p_message));
      return;
    exception when unique_violation then
      -- concurrent insert, retry loop
    end;
  end loop;
end; $$ language plpgsql security definer;

-- (Optional) RLS for RPC execution context; ensure owner is trusted.

-- NOTE: Replace permissive policies with participant-restricted policies once auth mapping is ready.
