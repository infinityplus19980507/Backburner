create table if not exists public.tasks (
  id text primary key,
  title text not null default 'Untitled task',
  status text not null default 'active',
  task_mode text not null default 'sequential',
  subtasks jsonb not null default '[]'::jsonb,
  completed_subtasks jsonb not null default '[]'::jsonb,
  log jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.tasks add column if not exists title text not null default 'Untitled task';
alter table public.tasks add column if not exists status text not null default 'active';
alter table public.tasks add column if not exists task_mode text not null default 'sequential';
alter table public.tasks add column if not exists subtasks jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists completed_subtasks jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists log jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists sort_order integer not null default 0;
alter table public.tasks add column if not exists created_at timestamptz not null default timezone('utc', now());
alter table public.tasks add column if not exists completed_at timestamptz;
alter table public.tasks add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.tasks enable row level security;

drop policy if exists "anon can read tasks" on public.tasks;
create policy "anon can read tasks"
on public.tasks
for select
to anon
using (true);

drop policy if exists "anon can insert tasks" on public.tasks;
create policy "anon can insert tasks"
on public.tasks
for insert
to anon
with check (true);

drop policy if exists "anon can update tasks" on public.tasks;
create policy "anon can update tasks"
on public.tasks
for update
to anon
using (true)
with check (true);

drop policy if exists "anon can delete tasks" on public.tasks;
create policy "anon can delete tasks"
on public.tasks
for delete
to anon
using (true);

insert into storage.buckets (id, name, public)
values ('note-images', 'note-images', true)
on conflict (id) do update
set public = true;

drop policy if exists "public can read note images" on storage.objects;
create policy "public can read note images"
on storage.objects
for select
to public
using (bucket_id = 'note-images');

drop policy if exists "anon can upload note images" on storage.objects;
create policy "anon can upload note images"
on storage.objects
for insert
to anon
with check (bucket_id = 'note-images');

drop policy if exists "anon can update note images" on storage.objects;
create policy "anon can update note images"
on storage.objects
for update
to anon
using (bucket_id = 'note-images')
with check (bucket_id = 'note-images');

drop policy if exists "anon can delete note images" on storage.objects;
create policy "anon can delete note images"
on storage.objects
for delete
to anon
using (bucket_id = 'note-images');
