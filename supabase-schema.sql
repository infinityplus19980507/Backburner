create table if not exists public.tasks (
  id text primary key,
  title text not null,
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

do $$
declare
  shared_items jsonb;
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'app_state'
  ) then
    select items into shared_items
    from public.app_state
    where key = 'shared';

    if shared_items is not null then
      insert into public.tasks (
        id,
        title,
        status,
        task_mode,
        subtasks,
        completed_subtasks,
        log,
        sort_order,
        created_at,
        completed_at,
        updated_at
      )
      select
        coalesce(entry->>'id', md5(random()::text || clock_timestamp()::text)),
        coalesce(entry->>'title', 'Untitled task'),
        coalesce(entry->>'status', 'active'),
        coalesce(entry->>'taskMode', 'sequential'),
        coalesce(entry->'subtasks', '[]'::jsonb),
        coalesce(entry->'completedSubtasks', '[]'::jsonb),
        coalesce(entry->'log', '[]'::jsonb),
        row_number() over () - 1,
        coalesce(
          to_timestamp(((entry->>'createdAt')::numeric) / 1000.0),
          timezone('utc', now())
        ),
        case
          when entry ? 'completedAt' and entry->>'completedAt' <> '' then
            to_timestamp(((entry->>'completedAt')::numeric) / 1000.0)
          else null
        end,
        timezone('utc', now())
      from jsonb_array_elements(shared_items) entry
      on conflict (id) do update
      set
        title = excluded.title,
        status = excluded.status,
        task_mode = excluded.task_mode,
        subtasks = excluded.subtasks,
        completed_subtasks = excluded.completed_subtasks,
        log = excluded.log,
        sort_order = excluded.sort_order,
        created_at = excluded.created_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at;
    end if;
  end if;
end $$;

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
