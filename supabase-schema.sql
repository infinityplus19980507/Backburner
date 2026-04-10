create table if not exists public.app_state (
  key text primary key,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.app_state enable row level security;

drop policy if exists "anon can read app state" on public.app_state;
create policy "anon can read app state"
on public.app_state
for select
to anon
using (true);

drop policy if exists "anon can insert app state" on public.app_state;
create policy "anon can insert app state"
on public.app_state
for insert
to anon
with check (true);

drop policy if exists "anon can update app state" on public.app_state;
create policy "anon can update app state"
on public.app_state
for update
to anon
using (true)
with check (true);

insert into public.app_state (key, items)
values ('shared', '[]'::jsonb)
on conflict (key) do nothing;
