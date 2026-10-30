create schema if not exists opengym;

-- One row per openGym account (Supabase Auth user). Replaces db.json "users".
create table opengym.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  email       text,
  admin       boolean not null default false,
  owner       boolean not null default false,
  disabled    boolean not null default false,
  lang        text,
  last_pull   timestamptz,
  last_seen   timestamptz,
  extra       jsonb not null default '{}'::jsonb,   -- coach consent and other per-user flags
  created_at  timestamptz not null default now()
);
create unique index opengym_profiles_name_lower on opengym.profiles (lower(name));

-- The synced document per profile. Replaces state-<uid>.json.
create table opengym.state (
  user_id     uuid primary key references opengym.profiles(id) on delete cascade,
  doc         jsonb not null default '{}'::jsonb,
  rev         integer not null default 0,
  wid         text,
  updated_at  timestamptz not null default now()
);

-- Web Push subscriptions. Replaces db.json "subs".
create table opengym.push_subs (
  endpoint    text primary key,
  user_id     uuid not null references opengym.profiles(id) on delete cascade,
  keys        jsonb not null,
  device_id   text,
  created_at  timestamptz not null default now()
);
create index opengym_push_subs_user on opengym.push_subs (user_id);

-- Rest timers waiting to fire as a push (picked up by pg_cron).
create table opengym.rest_timers (
  user_id     uuid not null references opengym.profiles(id) on delete cascade,
  device_id   text not null default '',
  fire_at     timestamptz not null,
  payload     jsonb not null default '{}'::jsonb,
  primary key (user_id, device_id)
);
create index opengym_rest_timers_fire on opengym.rest_timers (fire_at);

-- Invite codes (INVITE_ONLY). Replaces db.json "invites".
create table opengym.invites (
  code        text primary key,
  note        text,
  created_by  uuid references opengym.profiles(id) on delete set null,
  used_by     uuid references opengym.profiles(id) on delete set null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Admin activity log. Replaces the audit log file.
create table opengym.audit (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  event       text not null,
  actor_id    uuid,
  actor_name  text,
  target_id   uuid,
  target_name text,
  msg         text,
  ip          text
);
create index opengym_audit_at on opengym.audit (at desc);

-- Custom-exercise photos/videos stored in the opengym-media bucket. Replaces DATA_DIR/uploads.
create table opengym.media (
  user_id     uuid not null references opengym.profiles(id) on delete cascade,
  hash        text not null,
  mime        text not null,
  size        bigint not null,
  unref_at    timestamptz,          -- grace clock: no longer referenced by the document
  created_at  timestamptz not null default now(),
  primary key (user_id, hash)
);

-- Instance settings and secrets (VAPID keys, coach provider config). Server-only.
create table opengym.settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Only the opengym-api Edge Function (direct Postgres connection) touches this schema.
-- RLS on with no policies + no grants: the public Data API cannot read or write any of it.
alter table opengym.profiles    enable row level security;
alter table opengym.state       enable row level security;
alter table opengym.push_subs   enable row level security;
alter table opengym.rest_timers enable row level security;
alter table opengym.invites     enable row level security;
alter table opengym.audit       enable row level security;
alter table opengym.media       enable row level security;
alter table opengym.settings    enable row level security;
revoke all on schema opengym from anon, authenticated;
revoke all on all tables in schema opengym from anon, authenticated;

-- Private bucket for exercise media; served through the function with signed URLs.
insert into storage.buckets (id, name, public, file_size_limit)
values ('opengym-media', 'opengym-media', false, 52428800)
on conflict (id) do nothing;
