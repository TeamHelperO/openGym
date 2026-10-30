-- Live-workout presence (POST /api/activity), and the once-a-day marks of the reminder tick.
alter table opengym.profiles
  add column presence      jsonb,
  add column last_reminder date,
  add column last_nudge    date,
  add column invited_by    uuid references opengym.profiles(id) on delete set null;

-- The admin activity log carries success/failure and the action a check was for.
alter table opengym.audit
  add column ok  boolean not null default true,
  add column act text;
