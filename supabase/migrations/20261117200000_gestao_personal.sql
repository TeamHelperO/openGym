-- Personal trainers (SteelDay) beside academies (white label): the tenant says which it is.
-- Physical assessments (perimeters and bioimpedance), meal plans and the student's food diary.
alter table opengym.gyms add column kind text not null default 'academy' check (kind in ('academy','personal'));

create table opengym.gym_assessments (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references opengym.gyms(id) on delete cascade,
  member_id          uuid not null references opengym.gym_members(id) on delete cascade,
  date               text not null,
  weight_kg          double precision,
  height_cm          double precision,
  perimeters         jsonb not null default '{}'::jsonb,   -- cm, keyed by site (waist, hip, arm_r...)
  bio                jsonb not null default '{}'::jsonb,   -- bioimpedance readings (fat_pct, lean_kg...)
  notes              text not null default '',
  created_by_member  uuid references opengym.gym_members(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index gym_assessments_member on opengym.gym_assessments (gym_id, member_id, date);

create table opengym.gym_meal_plans (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references opengym.gyms(id) on delete cascade,
  member_id          uuid not null references opengym.gym_members(id) on delete cascade,
  name               text not null,
  notes              text not null default '',
  targets            jsonb not null default '{}'::jsonb,   -- kcal, protein, carbs, fat (g), water_ml
  meals              jsonb not null default '[]'::jsonb,   -- [{ key, name, time, items: [{ name, grams, kcal, protein, carbs, fat }], notes }]
  status             text not null default 'active' check (status in ('active','archived')),
  created_by_member  uuid references opengym.gym_members(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index gym_meal_plans_member on opengym.gym_meal_plans (gym_id, member_id, status);

create table opengym.gym_food_logs (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references opengym.gyms(id) on delete cascade,
  member_id   uuid not null references opengym.gym_members(id) on delete cascade,
  plan_id     uuid not null references opengym.gym_meal_plans(id) on delete cascade,
  date        text not null,
  meal_key    text not null,
  done        boolean not null default true,
  note        text not null default '',
  photo       bytea,
  photo_type  text,
  updated_at  timestamptz not null default now(),
  unique (plan_id, date, meal_key)
);
create index gym_food_logs_member on opengym.gym_food_logs (gym_id, member_id, date);

do $$
declare t text;
begin
  foreach t in array array['gym_assessments','gym_meal_plans','gym_food_logs']
  loop
    execute format('alter table opengym.%I enable row level security', t);
    execute format('revoke all on opengym.%I from anon, authenticated', t);
  end loop;
end $$;
