create table if not exists public.tasks (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
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

alter table public.tasks add column if not exists user_id uuid references auth.users(id) on delete cascade;
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

drop policy if exists "users can read own tasks" on public.tasks;
create policy "users can read own tasks"
on public.tasks
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users can insert own tasks" on public.tasks;
create policy "users can insert own tasks"
on public.tasks
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users can update own tasks" on public.tasks;
create policy "users can update own tasks"
on public.tasks
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can delete own tasks" on public.tasks;
create policy "users can delete own tasks"
on public.tasks
for delete
to authenticated
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('note-images', 'note-images', false)
on conflict (id) do update
set public = false;

drop policy if exists "users can read own note images" on storage.objects;
create policy "users can read own note images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'note-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "users can upload own note images" on storage.objects;
create policy "users can upload own note images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'note-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "users can update own note images" on storage.objects;
create policy "users can update own note images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'note-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'note-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "users can delete own note images" on storage.objects;
create policy "users can delete own note images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'note-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
