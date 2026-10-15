-- Page views + distinct consented browsers. Only SHA-256 of a random UUID is stored;
-- no IPs, user agents, URLs, names, contact details or LINE/staff IDs.
-- Run before deploying the KPI. Safe to rerun; existing counts are preserved.
begin;
create table if not exists public.site_daily_views (
  day date primary key,
  views bigint not null default 0 check (views >= 0)
);
alter table public.site_daily_views enable row level security;
revoke all on public.site_daily_views from public, anon, authenticated;
grant select, insert, update on public.site_daily_views to service_role;
create table if not exists public.site_visitors (
  visitor_hash text primary key check (visitor_hash ~ '^[0-9a-f]{64}$'),
  first_day date not null
);
create table if not exists public.site_daily_visitors (
  day date not null,
  visitor_hash text not null references public.site_visitors(visitor_hash),
  primary key (day, visitor_hash)
);
alter table public.site_visitors enable row level security;
alter table public.site_daily_visitors enable row level security;
revoke all on public.site_visitors, public.site_daily_visitors from public, anon, authenticated;
grant select, insert on public.site_visitors, public.site_daily_visitors to service_role;
-- A random ID for each document (not a browser/user ID). Short-lived deduplication
-- lets a consent update/retry count that same view once. Automatically removed after 2 days.
create table if not exists public.site_view_events (
  view_id uuid primary key,
  day date not null,
  visitor_hash text check (visitor_hash ~ '^[0-9a-f]{64}$')
);
create index if not exists site_view_events_day_idx on public.site_view_events(day);
alter table public.site_view_events enable row level security;
revoke all on public.site_view_events from public, anon, authenticated;
grant select, insert, update, delete on public.site_view_events to service_role;

insert into public.site_daily_views (day, views)
values ((now() at time zone 'Asia/Bangkok')::date, 0)
on conflict (day) do nothing;

create or replace function public.get_site_stats()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'today', coalesce(sum(v.views) filter (where v.day = d.today), 0),
    'month', coalesce(sum(v.views) filter (where v.day >= date_trunc('month', d.today)::date), 0),
    'total', coalesce(sum(v.views), 0),
    'visitors_today', (select count(*) from public.site_daily_visitors where day = d.today),
    'visitors_month', (select count(distinct visitor_hash) from public.site_daily_visitors where day >= date_trunc('month', d.today)::date and day <= d.today),
    'visitors_total', (select count(*) from public.site_visitors where first_day <= d.today),
    'date', d.today,
    'since', coalesce(min(v.day), d.today)
  )
  from (select (now() at time zone 'Asia/Bangkok')::date as today) d
  left join public.site_daily_views v on v.day <= d.today
  group by d.today;
$$;

create or replace function public.record_site_view(p_view_id uuid, p_visitor_hash text default null)
returns jsonb language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_day date;
  v_hash text;
begin
  if p_view_id is null then raise exception 'Missing view ID'; end if;
  if p_visitor_hash is not null and p_visitor_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid visitor hash';
  end if;
  delete from public.site_view_events where day < (now() at time zone 'Asia/Bangkok')::date - 2;
  insert into public.site_view_events (view_id, day)
  values (p_view_id, (now() at time zone 'Asia/Bangkok')::date)
  on conflict (view_id) do nothing;
  if found then
    insert into public.site_daily_views as v (day, views)
    values ((now() at time zone 'Asia/Bangkok')::date, 1)
    on conflict (day) do update set views = v.views + 1;
  end if;
  select day, visitor_hash into v_day, v_hash from public.site_view_events where view_id = p_view_id for update;
  if p_visitor_hash is not null and v_hash is null then
    update public.site_view_events set visitor_hash = p_visitor_hash where view_id = p_view_id;
    insert into public.site_visitors (visitor_hash, first_day)
    values (p_visitor_hash, v_day)
    on conflict (visitor_hash) do nothing;
    insert into public.site_daily_visitors (day, visitor_hash)
    values (v_day, p_visitor_hash)
    on conflict (day, visitor_hash) do nothing;
  end if;
  return public.get_site_stats();
end;
$$;
revoke all on function public.get_site_stats() from public, anon, authenticated;
revoke all on function public.record_site_view(uuid, text) from public, anon, authenticated;
grant execute on function public.get_site_stats() to service_role;
grant execute on function public.record_site_view(uuid, text) to service_role;
commit;
