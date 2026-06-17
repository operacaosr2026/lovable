alter table public.habits add column if not exists annual_goal integer;
alter table public.calendar_events add column if not exists member_ids uuid[] not null default '{}'::uuid[];
