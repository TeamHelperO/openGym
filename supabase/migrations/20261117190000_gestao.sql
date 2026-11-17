-- Gestão de academias (steelday-gestao Edge Function): academies, people, training sheets,
-- finance, supplies, shop (PDV) and turnstiles. Same rule as the rest of the opengym schema:
-- RLS on with no policies and no grants, so only the Edge Functions (direct Postgres connection)
-- read or write it. Money is integer cents; calendar dates are 'YYYY-MM-DD' text, as the app
-- sends them; instants are timestamptz.

create table opengym.gyms (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique,
  legal_name     text not null default '',
  document       text not null default '',
  email          text not null default '',
  phone          text not null default '',
  address        text not null default '',
  primary_color  text not null default '#2563eb',
  custom_domain  text unique,
  logo           bytea,
  logo_type      text,
  logo_version   integer not null default 0,
  status         text not null default 'active' check (status in ('active','suspended')),
  settings       jsonb not null default '{}'::jsonb,
  created_by     uuid references opengym.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create table opengym.gym_members (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references opengym.gyms(id) on delete cascade,
  user_id            uuid references opengym.profiles(id) on delete set null,
  role               text not null check (role in ('gym_admin','trainer','student')),
  status             text not null default 'active' check (status in ('active','inactive')),
  name               text not null,
  email              text not null default '',
  phone              text not null default '',
  document           text not null default '',
  birth_date         text,
  goal               text not null default '',
  health_notes       text not null default '',
  notes              text not null default '',
  trainer_member_id  uuid references opengym.gym_members(id) on delete set null,
  invite_code        text unique,
  access_id          integer,
  card_number        text,
  joined_via         text not null default 'invite',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index gym_members_user on opengym.gym_members (gym_id, user_id) where user_id is not null;
create unique index gym_members_access on opengym.gym_members (gym_id, access_id) where access_id is not null;
create unique index gym_members_card on opengym.gym_members (gym_id, card_number) where card_number is not null and card_number <> '';
create index gym_members_role on opengym.gym_members (gym_id, role, status);
create index gym_members_user_id on opengym.gym_members (user_id);

create table opengym.gym_workouts (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references opengym.gyms(id) on delete cascade,
  name               text not null,
  description        text not null default '',
  level              text not null default '',
  plan               jsonb not null,
  created_by_member  uuid references opengym.gym_members(id) on delete set null,
  archived           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index gym_workouts_gym on opengym.gym_workouts (gym_id, archived);

create table opengym.gym_assignments (
  id                  uuid primary key default gen_random_uuid(),
  gym_id              uuid not null references opengym.gyms(id) on delete cascade,
  template_id         uuid references opengym.gym_workouts(id) on delete set null,
  student_member_id   uuid not null references opengym.gym_members(id) on delete cascade,
  assigned_by_member  uuid references opengym.gym_members(id) on delete set null,
  name                text not null,
  plan                jsonb not null,
  notes               text not null default '',
  start_date          text,
  end_date            text,
  status              text not null default 'active' check (status in ('active','archived')),
  imported_at         timestamptz,
  created_at          timestamptz not null default now()
);
create index gym_assignments_student on opengym.gym_assignments (gym_id, student_member_id, status);

create table opengym.gym_plans (
  id               uuid primary key default gen_random_uuid(),
  gym_id           uuid not null references opengym.gyms(id) on delete cascade,
  name             text not null,
  description      text not null default '',
  price_cents      integer not null check (price_cents >= 0),
  interval_months  integer not null default 1 check (interval_months between 1 and 24),
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table opengym.gym_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references opengym.gyms(id) on delete cascade,
  member_id    uuid not null references opengym.gym_members(id) on delete cascade,
  plan_id      uuid not null references opengym.gym_plans(id),
  price_cents  integer not null check (price_cents >= 0),
  start_date   text not null,
  due_day      integer not null check (due_day between 1 and 28),
  status       text not null default 'active' check (status in ('active','canceled')),
  canceled_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index gym_subscriptions_gym on opengym.gym_subscriptions (gym_id, status);

create table opengym.gym_categories (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references opengym.gyms(id) on delete cascade,
  name        text not null,
  kind        text not null check (kind in ('income','expense')),
  system_key  text,
  unique (gym_id, kind, name)
);

create table opengym.gym_transactions (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references opengym.gyms(id) on delete cascade,
  kind            text not null check (kind in ('income','expense')),
  category_id     uuid references opengym.gym_categories(id) on delete set null,
  description     text not null default '',
  amount_cents    integer not null check (amount_cents > 0),
  date            text not null,
  payment_method  text not null default 'cash',
  source          text not null default 'manual' check (source in ('manual','charge','sale','purchase','cash')),
  source_id       uuid,
  status          text not null default 'active' check (status in ('active','canceled')),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  canceled_at     timestamptz
);
create index gym_transactions_date on opengym.gym_transactions (gym_id, date);

create table opengym.gym_charges (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references opengym.gyms(id) on delete cascade,
  member_id          uuid not null references opengym.gym_members(id) on delete cascade,
  subscription_id    uuid references opengym.gym_subscriptions(id) on delete set null,
  sale_id            uuid,
  description        text not null,
  amount_cents       integer not null check (amount_cents > 0),
  due_date           text not null,
  reference_month    text,
  status             text not null default 'open' check (status in ('open','paid','canceled')),
  paid_at            text,
  paid_amount_cents  integer,
  payment_method     text,
  transaction_id     uuid references opengym.gym_transactions(id) on delete set null,
  created_at         timestamptz not null default now()
);
create unique index gym_charges_sub_month on opengym.gym_charges (subscription_id, reference_month) where subscription_id is not null;
create index gym_charges_status on opengym.gym_charges (gym_id, status, due_date);

create table opengym.gym_suppliers (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references opengym.gyms(id) on delete cascade,
  name        text not null,
  document    text not null default '',
  phone       text not null default '',
  email       text not null default '',
  notes       text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table opengym.gym_supplies (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references opengym.gyms(id) on delete cascade,
  name        text not null,
  unit        text not null default 'un',
  category    text not null default '',
  stock_qty   double precision not null default 0,
  min_qty     double precision not null default 0,
  cost_cents  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table opengym.gym_products (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references opengym.gyms(id) on delete cascade,
  name         text not null,
  sku          text not null default '',
  category     text not null default '',
  price_cents  integer not null check (price_cents >= 0),
  cost_cents   integer not null default 0,
  stock_qty    double precision not null default 0,
  min_qty      double precision not null default 0,
  track_stock  boolean not null default true,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table opengym.gym_purchases (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references opengym.gyms(id) on delete cascade,
  supplier_id     uuid references opengym.gym_suppliers(id) on delete set null,
  status          text not null default 'draft' check (status in ('draft','ordered','received','canceled')),
  notes           text not null default '',
  total_cents     integer not null default 0,
  payment_method  text,
  transaction_id  uuid references opengym.gym_transactions(id) on delete set null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  ordered_at      timestamptz,
  received_at     timestamptz
);

create table opengym.gym_purchase_items (
  id               uuid primary key default gen_random_uuid(),
  purchase_id      uuid not null references opengym.gym_purchases(id) on delete cascade,
  kind             text not null default 'supply' check (kind in ('supply','product')),
  item_id          uuid not null,
  name             text not null,
  qty              double precision not null check (qty > 0),
  unit_cost_cents  integer not null check (unit_cost_cents >= 0)
);

create table opengym.gym_stock_moves (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references opengym.gyms(id) on delete cascade,
  kind        text not null check (kind in ('product','supply')),
  ref_id      uuid not null,
  qty_delta   double precision not null,
  reason      text not null,
  source_id   uuid,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index gym_stock_moves_ref on opengym.gym_stock_moves (gym_id, kind, ref_id);

create table opengym.gym_cash_sessions (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references opengym.gyms(id) on delete cascade,
  status          text not null default 'open' check (status in ('open','closed')),
  opening_cents   integer not null default 0,
  expected_cents  integer,
  counted_cents   integer,
  notes           text not null default '',
  opened_by       uuid,
  opened_at       timestamptz not null default now(),
  closed_by       uuid,
  closed_at       timestamptz
);
create unique index gym_cash_one_open on opengym.gym_cash_sessions (gym_id) where status = 'open';

create table opengym.gym_cash_moves (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references opengym.gyms(id) on delete cascade,
  session_id    uuid not null references opengym.gym_cash_sessions(id) on delete cascade,
  kind          text not null check (kind in ('withdrawal','deposit')),
  amount_cents  integer not null check (amount_cents > 0),
  reason        text not null default '',
  created_by    uuid,
  created_at    timestamptz not null default now()
);

create table opengym.gym_sales (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references opengym.gyms(id) on delete cascade,
  session_id      uuid references opengym.gym_cash_sessions(id) on delete set null,
  member_id       uuid references opengym.gym_members(id) on delete set null,
  subtotal_cents  integer not null,
  discount_cents  integer not null default 0,
  total_cents     integer not null,
  payment_method  text not null,
  paid_cents      integer not null default 0,
  change_cents    integer not null default 0,
  status          text not null default 'completed' check (status in ('completed','canceled')),
  transaction_id  uuid references opengym.gym_transactions(id) on delete set null,
  charge_id       uuid,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  canceled_at     timestamptz
);
create index gym_sales_date on opengym.gym_sales (gym_id, created_at);

create table opengym.gym_sale_items (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references opengym.gym_sales(id) on delete cascade,
  product_id        uuid references opengym.gym_products(id) on delete set null,
  name              text not null,
  qty               double precision not null check (qty > 0),
  unit_price_cents  integer not null,
  total_cents       integer not null
);

create table opengym.gym_devices (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references opengym.gyms(id) on delete cascade,
  name            text not null,
  kind            text not null check (kind in ('controlid','generic')),
  serial          text,
  token_hash      text unique,
  release_action  text not null default 'catra_clockwise',
  allowed_ip      text not null default '',
  active          boolean not null default true,
  last_seen_at    timestamptz,
  last_ip         text,
  created_at      timestamptz not null default now()
);
create unique index gym_devices_serial on opengym.gym_devices (serial) where serial is not null and serial <> '';

create table opengym.gym_access_logs (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references opengym.gyms(id) on delete cascade,
  device_id   uuid references opengym.gym_devices(id) on delete set null,
  member_id   uuid references opengym.gym_members(id) on delete set null,
  identifier  text not null default '',
  method      text not null default 'fingerprint',
  allowed     boolean not null,
  reason      text not null default '',
  by_user     uuid,
  at          timestamptz not null default now()
);
create index gym_access_logs_at on opengym.gym_access_logs (gym_id, at desc);
create index gym_access_logs_member on opengym.gym_access_logs (member_id, at desc);

create table opengym.gym_device_commands (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references opengym.gyms(id) on delete cascade,
  device_id    uuid not null references opengym.gym_devices(id) on delete cascade,
  purpose      text not null,
  member_id    uuid references opengym.gym_members(id) on delete set null,
  verb         text not null default 'POST',
  endpoint     text not null,
  body         jsonb not null default '{}'::jsonb,
  status       text not null default 'queued' check (status in ('queued','sent','done','failed','canceled')),
  result       jsonb,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  done_at      timestamptz
);
create index gym_device_commands_queue on opengym.gym_device_commands (device_id, status, created_at);

create table opengym.gym_audit (
  id       uuid primary key default gen_random_uuid(),
  gym_id   uuid,
  user_id  uuid,
  action   text not null,
  detail   jsonb not null default '{}'::jsonb,
  at       timestamptz not null default now()
);
create index gym_audit_at on opengym.gym_audit (gym_id, at desc);

do $$
declare t text;
begin
  foreach t in array array['gyms','gym_members','gym_workouts','gym_assignments','gym_plans','gym_subscriptions',
    'gym_categories','gym_transactions','gym_charges','gym_suppliers','gym_supplies','gym_products','gym_purchases',
    'gym_purchase_items','gym_stock_moves','gym_cash_sessions','gym_cash_moves','gym_sales','gym_sale_items',
    'gym_devices','gym_access_logs','gym_device_commands','gym_audit']
  loop
    execute format('alter table opengym.%I enable row level security', t);
    execute format('revoke all on opengym.%I from anon, authenticated', t);
  end loop;
end $$;
