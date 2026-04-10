# Backburner

Backburner is a lightweight ADHD-friendly web app for:

- dumping tasks into a backburner list
- breaking them into subtasks
- pulling out a quick win based on time
- keeping notes and photos attached to each task

This version is a simple static frontend backed by Supabase.

## Files

- `index.html`
  Main app markup
- `styles.css`
  App styling
- `app.js`
  Frontend behavior and Supabase sync
- `supabase-schema.sql`
  Supabase table, storage bucket, and policy setup

## Current Data Model

The app currently uses:

- `public.tasks`
  One row per task
- `tasks.subtasks`
  JSON array of active subtasks
- `tasks.completed_subtasks`
  JSON array of completed subtasks
- `tasks.log`
  JSON array of notes and completed-subtask timeline entries
- Supabase Storage bucket: `note-images`
  Stores uploaded note photos

The app does not currently use separate `subtasks`, `notes`, or `log_entries` tables.

## Local Testing

Open the app by opening `index.html` in a browser.

If you want Finder:

1. Open Finder
2. Press `Command + Shift + G`
3. Paste `/Users/karenyamaguchi/Desktop/Codex/Backburner`
4. Open `index.html`

## Supabase Setup

The app is currently configured for this Supabase project:

- `https://dorbawcjsrrkmreltpgw.supabase.co`

To set up Supabase:

1. Open your Supabase project
2. Go to `SQL Editor`
3. Open `supabase-schema.sql`
4. Paste it into SQL Editor
5. Run it

This creates:

- the `tasks` table
- row-level policies for shared anon access
- the `note-images` storage bucket
- storage policies for note image uploads

## Deployment

Upload these files to your site or GitHub deployment:

- `index.html`
- `styles.css`
- `app.js`

If you are updating the Supabase structure too, also keep:

- `supabase-schema.sql`

## Public Behavior Right Now

This version is currently:

- no login
- shared data across devices
- shared `tasks` table
- shared `note-images` bucket

So if multiple people use the public site, they will be working with the same data.

## Current Mobile UX Notes

- subtasks on mobile use a compact layout
- drag uses a hold-and-drag grip on phone
- mobile subtask edit controls are hidden until opened
- note composer is collapsed behind an `Add note` button
- note entries are collapsed until opened

## Zip Bundle

The latest bundled files are usually exported as:

- `backburner-web-files.zip`

## Next Likely Improvements

- smoother mobile drag/drop for subtasks
- per-user login
- tighter note/photo editing
- more polished mobile layout transitions
