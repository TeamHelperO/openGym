create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- A random secret the tick job sends and the function checks (opengym.settings, server-only).
insert into opengym.settings (key, value)
values ('cron', jsonb_build_object('secret', encode(extensions.gen_random_bytes(24), 'hex')))
on conflict (key) do nothing;

-- Every minute: rest timers due, workout reminders and nudges, and (hourly) media and log cleanup.
select cron.schedule(
  'opengym-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://qyvbwlylalqtvfovczbb.supabase.co/functions/v1/opengym-api/api/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value->>'secret' from opengym.settings where key = 'cron')
    ),
    body := '{}'::jsonb
  );
  $$
);
