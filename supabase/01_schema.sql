-- =====================================================================
-- 工作時程規劃器：建表 + 安全規則（RLS）
-- 貼到 Supabase → SQL Editor → Run。可以重複執行，不會重複建立或刪資料。
--
-- 設計重點：
--   1. 每張表都有 owner_id，RLS 只允許登入者讀寫自己的資料。
--   2. 子表用「複合外鍵」綁住 owner_id，就算知道別人的 id 也掛不上去。
--   3. 未登入（anon）完全沒有權限，連表都看不到。
--   4. 資料庫層再擋一次：負數天數、工作依賴自己、循環依賴、兩個發售標記。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 共用：自動更新 updated_at
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 範本
-- ---------------------------------------------------------------------
create table if not exists public.templates (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, owner_id)
);

create table if not exists public.template_tasks (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  owner_id    uuid not null default auth.uid(),
  name        text not null check (length(trim(name)) > 0),
  duration    int  not null default 1 check (duration >= 0),          -- 0 = 里程碑
  day_type    text not null default 'workday' check (day_type in ('workday', 'calendar')),
  buffer_days int  not null default 0 check (buffer_days >= 0),
  sort_order  int  not null default 0,
  is_launch   boolean not null default false,                         -- 標為「發售」
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (template_id, owner_id) references public.templates (id, owner_id) on delete cascade,
  unique (id, template_id, owner_id)
);

create table if not exists public.template_task_deps (
  task_id       uuid not null,                                        -- 這項工作
  depends_on_id uuid not null,                                        -- 要等這項完成
  template_id   uuid not null,
  owner_id      uuid not null default auth.uid(),
  lag_days      int  not null default 0 check (lag_days >= 0),        -- 間隔天數
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id),                                   -- 不能依賴自己
  foreign key (task_id, template_id, owner_id)
    references public.template_tasks (id, template_id, owner_id) on delete cascade,
  foreign key (depends_on_id, template_id, owner_id)
    references public.template_tasks (id, template_id, owner_id) on delete cascade
);


-- ---------------------------------------------------------------------
-- 專案
-- ---------------------------------------------------------------------
create table if not exists public.projects (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  template_id          uuid,                                          -- 從哪個範本建立（範本刪了就變空白）
  name                 text not null check (length(trim(name)) > 0),
  start_date           date not null,                                 -- 專案開工日
  status               text not null default 'active' check (status in ('planning', 'active', 'done', 'archived')),
  note                 text,
  baseline_launch_date date,                                          -- 設為基準時的發售日，用來算延誤天數
  baseline_set_at      timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (template_id, owner_id) references public.templates (id, owner_id) on delete set null (template_id),
  unique (id, owner_id)
);

create table if not exists public.project_tasks (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null,
  owner_id       uuid not null default auth.uid(),
  name           text not null check (length(trim(name)) > 0),
  duration       int  not null default 1 check (duration >= 0),
  day_type       text not null default 'workday' check (day_type in ('workday', 'calendar')),
  buffer_days    int  not null default 0 check (buffer_days >= 0),
  sort_order     int  not null default 0,
  is_launch      boolean not null default false,
  earliest_start date,                                                -- 指定最早開始日（選填）
  actual_start   date,                                                -- 實際開始日
  actual_end     date,                                                -- 實際完成日
  baseline_start date,                                                -- 設為基準時的預計起訖
  baseline_end   date,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (actual_start is null or actual_end is null or actual_end >= actual_start),
  foreign key (project_id, owner_id) references public.projects (id, owner_id) on delete cascade,
  unique (id, project_id, owner_id)
);

create table if not exists public.project_task_deps (
  task_id       uuid not null,
  depends_on_id uuid not null,
  project_id    uuid not null,
  owner_id      uuid not null default auth.uid(),
  lag_days      int  not null default 0 check (lag_days >= 0),
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id),
  foreign key (task_id, project_id, owner_id)
    references public.project_tasks (id, project_id, owner_id) on delete cascade,
  foreign key (depends_on_id, project_id, owner_id)
    references public.project_tasks (id, project_id, owner_id) on delete cascade
);


-- ---------------------------------------------------------------------
-- 假日表
-- ---------------------------------------------------------------------
create table if not exists public.holidays (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date     date not null,
  type     text not null check (type in ('off', 'workday')),          -- off = 放假，workday = 補班
  name     text,
  primary key (owner_id, date),
  -- 補班一定是週六日，避免把平日誤標成補班
  check (type <> 'workday' or extract(isodow from date) in (6, 7))
);

-- 已匯入假日資料的年份；計算時用來判斷要不要發警告
create table if not exists public.holiday_years (
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  year        int  not null check (year between 2000 and 2100),
  source      text,                                                   -- 資料來源備註
  imported_at timestamptz not null default now(),
  primary key (owner_id, year)
);


-- ---------------------------------------------------------------------
-- 索引（外鍵欄位都要有，避免刪除、查詢變慢）
-- ---------------------------------------------------------------------
create index if not exists templates_owner_idx          on public.templates (owner_id);
create index if not exists template_tasks_tpl_idx       on public.template_tasks (template_id, owner_id);
create index if not exists template_task_deps_task_idx  on public.template_task_deps (task_id, template_id, owner_id);
create index if not exists template_task_deps_dep_idx   on public.template_task_deps (depends_on_id, template_id, owner_id);
create index if not exists projects_owner_idx           on public.projects (owner_id);
create index if not exists projects_template_idx        on public.projects (template_id, owner_id);
create index if not exists project_tasks_proj_idx       on public.project_tasks (project_id, owner_id);
create index if not exists project_task_deps_task_idx   on public.project_task_deps (task_id, project_id, owner_id);
create index if not exists project_task_deps_dep_idx    on public.project_task_deps (depends_on_id, project_id, owner_id);

-- 每個範本、每個專案最多只能有一項「發售」
create unique index if not exists template_tasks_one_launch on public.template_tasks (template_id) where is_launch;
create unique index if not exists project_tasks_one_launch  on public.project_tasks (project_id)  where is_launch;


-- ---------------------------------------------------------------------
-- 觸發器：updated_at
-- ---------------------------------------------------------------------
drop trigger if exists set_updated_at on public.templates;
create trigger set_updated_at before update on public.templates
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.template_tasks;
create trigger set_updated_at before update on public.template_tasks
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.projects;
create trigger set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.project_tasks;
create trigger set_updated_at before update on public.project_tasks
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 觸發器：擋下循環依賴
-- 新增「A 要等 B」時，檢查 B 往上追的前置工作裡有沒有 A，有就是循環。
-- ---------------------------------------------------------------------
create or replace function public.prevent_dep_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_cycle boolean;
begin
  execute format($q$
    with recursive upstream(id) as (
      select depends_on_id from %1$I.%2$I where task_id = $1
      union
      select d.depends_on_id from %1$I.%2$I d join upstream u on d.task_id = u.id
    )
    select exists (select 1 from upstream where id = $2)
  $q$, tg_table_schema, tg_table_name)
  into is_cycle
  using new.depends_on_id, new.task_id;

  if is_cycle then
    raise exception '前置工作形成循環，無法儲存' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_cycle on public.template_task_deps;
create trigger prevent_cycle before insert or update on public.template_task_deps
  for each row execute function public.prevent_dep_cycle();

drop trigger if exists prevent_cycle on public.project_task_deps;
create trigger prevent_cycle before insert or update on public.project_task_deps
  for each row execute function public.prevent_dep_cycle();


-- ---------------------------------------------------------------------
-- 函式：從範本建立專案（一次複製全部工作與依賴，失敗就整筆不建）
-- 前端呼叫：supabase.rpc('create_project_from_template', { p_template_id, p_name, p_start_date })
-- ---------------------------------------------------------------------
create or replace function public.create_project_from_template(
  p_template_id uuid,
  p_name        text,
  p_start_date  date
)
returns uuid
language plpgsql
security invoker            -- 以登入者身分執行，RLS 照樣生效
set search_path = ''
as $$
declare
  v_project uuid;
  v_new     uuid;
  v_map     jsonb := '{}'::jsonb;   -- 範本工作 id → 專案工作 id
  r         record;
begin
  if not exists (select 1 from public.templates where id = p_template_id) then
    raise exception '找不到這個範本';
  end if;

  insert into public.projects (name, template_id, start_date)
  values (p_name, p_template_id, p_start_date)
  returning id into v_project;

  for r in
    select * from public.template_tasks
    where template_id = p_template_id
    order by sort_order, created_at
  loop
    insert into public.project_tasks (project_id, name, duration, day_type, buffer_days, sort_order, is_launch, note)
    values (v_project, r.name, r.duration, r.day_type, r.buffer_days, r.sort_order, r.is_launch, r.note)
    returning id into v_new;
    v_map := v_map || jsonb_build_object(r.id::text, v_new);
  end loop;

  insert into public.project_task_deps (task_id, depends_on_id, project_id, lag_days)
  select (v_map ->> d.task_id::text)::uuid,
         (v_map ->> d.depends_on_id::text)::uuid,
         v_project,
         d.lag_days
  from public.template_task_deps d
  where d.template_id = p_template_id;

  return v_project;
end;
$$;


-- ---------------------------------------------------------------------
-- RLS：只能讀寫自己的資料
-- （CREATE POLICY 不支援 IF NOT EXISTS，所以先 DROP 再 CREATE）
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'templates', 'template_tasks', 'template_task_deps',
    'projects', 'project_tasks', 'project_task_deps',
    'holidays', 'holiday_years'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_only on public.%I', t);
    execute format(
      'create policy owner_only on public.%I for all to authenticated
         using (owner_id = (select auth.uid()))
         with check (owner_id = (select auth.uid()))', t);
    -- 未登入的訪客完全沒有權限；登入者只有增刪改查（能碰哪幾筆由上面的 RLS 決定）
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

revoke execute on function public.create_project_from_template(uuid, text, date) from public, anon;
grant  execute on function public.create_project_from_template(uuid, text, date) to authenticated;
revoke execute on function public.prevent_dep_cycle() from public, anon, authenticated;
revoke execute on function public.set_updated_at()   from public, anon, authenticated;
