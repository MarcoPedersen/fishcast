-- FishCast v2 — run this once in the Supabase SQL editor (Dashboard → SQL).
-- One row per user holding their full setup (locations, species, availability).

create table if not exists public.setups (
  user_id uuid primary key references auth.users (id) on delete cascade,
  setup jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.setups enable row level security;

create policy "Users can read own setup"
  on public.setups for select using (auth.uid() = user_id);

create policy "Users can insert own setup"
  on public.setups for insert with check (auth.uid() = user_id);

create policy "Users can update own setup"
  on public.setups for update using (auth.uid() = user_id);
