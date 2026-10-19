-- =====================================================================
-- 工作時程規劃器：資料庫驗證
-- 執行 01_schema.sql、並在 Authentication 建好你的帳號後，貼到 SQL Editor → Run。
--
-- 會模擬三種身分實際操作資料庫：
--   你本人（登入）／陌生人（另一個登入帳號）／未登入訪客
-- 測試資料在最後全部自動復原，不會留在資料庫裡。
-- 結果會列成一張表，每一列都應該是 ✓。任何一列是 ✗ 就代表有問題。
--
-- 寫法說明：
--   「應該被擋下」的測試，若沒被擋下會丟出 VF001 讓那筆資料立刻復原；
--   被擋下時還會檢查錯誤代碼，確認是「對的原因」被擋，不是別的錯誤。
-- =====================================================================

drop table if exists pg_temp._verify;
create temp table _verify (no int, item text, result text);

do $$
declare
  tables   text[] := array['templates','template_tasks','template_task_deps','projects',
                           'project_tasks','project_task_deps','holidays','holiday_years'];
  me       uuid;
  stranger uuid := gen_random_uuid();          -- 不存在的帳號，模擬陌生人
  res      text[] := '{}';                     -- 測試結果（變數不會被復原）
  t        text;
  n        int;
  v_tpl    uuid;
  v_a      uuid;
  v_b      uuid;
  v_c      uuid;
  v_proj   uuid;
begin
  select id into me from auth.users order by created_at limit 1;
  if me is null then
    insert into _verify values (0, '找不到帳號', '✗ 請先到 Authentication 建立你的帳號');
    return;
  end if;

  -- ---------------------------------------------------------------
  -- 1. 權限設定（直接查系統表）
  -- ---------------------------------------------------------------
  foreach t in array tables loop
    select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relname = t and c.relrowsecurity;
    res := res || format('RLS 已開啟：%s|%s', t, case when n = 1 then '✓' else '✗ 沒開' end);
  end loop;
  foreach t in array tables loop
    res := res || format('未登入訪客沒有權限：%s|%s', t,
      case when has_table_privilege('anon', format('public.%I', t), 'SELECT, INSERT, UPDATE, DELETE')
                or has_any_column_privilege('anon', format('public.%I', t), 'SELECT')
           then '✗ 有權限' else '✓' end);
  end loop;
  res := res || format('未登入訪客不能呼叫建立專案函式|%s',
    case when has_function_privilege('anon', 'public.create_project_from_template(uuid, text, date)', 'EXECUTE')
         then '✗ 可以呼叫' else '✓' end);

  -- ---------------------------------------------------------------
  -- 以下實際操作資料，最後全部復原
  -- ---------------------------------------------------------------
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', me, 'role', 'authenticated')::text, true);
    set local role authenticated;

    -- 2. 本人建立測試資料：A → B（發售）→ C（間隔 2 天）
    begin
      insert into public.templates (name) values ('__驗證用範本__') returning id into v_tpl;
      insert into public.template_tasks (template_id, name, duration, sort_order) values (v_tpl, 'A', 3, 1) returning id into v_a;
      insert into public.template_tasks (template_id, name, duration, sort_order, is_launch) values (v_tpl, 'B', 2, 2, true) returning id into v_b;
      insert into public.template_tasks (template_id, name, duration, sort_order) values (v_tpl, 'C', 1, 3) returning id into v_c;
      insert into public.template_task_deps (task_id, depends_on_id, template_id) values (v_b, v_a, v_tpl);
      insert into public.template_task_deps (task_id, depends_on_id, template_id, lag_days) values (v_c, v_b, v_tpl, 2);
      res := res || '本人可以建立範本、工作、依賴|✓'::text;
    exception when others then
      res := res || ('本人可以建立範本、工作、依賴|✗ ' || sqlerrm);
      raise exception using errcode = 'VF000', message = '__ROLLBACK__';  -- 後面都測不了，直接結束
    end;

    -- 3. 資料庫層的防呆（每項沒擋住就立刻復原，不影響下一項）
    begin
      insert into public.template_task_deps (task_id, depends_on_id, template_id) values (v_a, v_c, v_tpl);
      raise exception using errcode = 'VF001';
    exception
      when sqlstate 'VF001'    then res := res || '擋下循環依賴（A→C→B→A）|✗ 沒擋住'::text;
      when check_violation     then res := res || '擋下循環依賴（A→C→B→A）|✓'::text;
      when others              then res := res || ('擋下循環依賴（A→C→B→A）|✗ 錯誤原因不對：' || sqlerrm);
    end;
    begin
      insert into public.template_task_deps (task_id, depends_on_id, template_id) values (v_a, v_a, v_tpl);
      raise exception using errcode = 'VF001';
    exception
      when sqlstate 'VF001'    then res := res || '擋下依賴自己|✗ 沒擋住'::text;
      when check_violation     then res := res || '擋下依賴自己|✓'::text;
      when others              then res := res || ('擋下依賴自己|✗ 錯誤原因不對：' || sqlerrm);
    end;
    begin
      insert into public.template_tasks (template_id, name, duration) values (v_tpl, 'X', -1);
      raise exception using errcode = 'VF001';
    exception
      when sqlstate 'VF001'    then res := res || '擋下負數天數|✗ 沒擋住'::text;
      when check_violation     then res := res || '擋下負數天數|✓'::text;
      when others              then res := res || ('擋下負數天數|✗ 錯誤原因不對：' || sqlerrm);
    end;
    begin
      insert into public.template_tasks (template_id, name, duration, is_launch) values (v_tpl, 'X', 1, true);
      raise exception using errcode = 'VF001';
    exception
      when sqlstate 'VF001'    then res := res || '擋下第二個發售標記|✗ 沒擋住'::text;
      when unique_violation    then res := res || '擋下第二個發售標記|✓'::text;
      when others              then res := res || ('擋下第二個發售標記|✗ 錯誤原因不對：' || sqlerrm);
    end;
    begin
      insert into public.holidays (date, type) values ('2026-11-04', 'workday');
      raise exception using errcode = 'VF001';
    exception
      when sqlstate 'VF001'    then res := res || '擋下平日標成補班|✗ 沒擋住'::text;
      when check_violation     then res := res || '擋下平日標成補班|✓'::text;
      when others              then res := res || ('擋下平日標成補班|✗ 錯誤原因不對：' || sqlerrm);
    end;

    -- 4. 從範本建立專案
    begin
      v_proj := public.create_project_from_template(v_tpl, '__驗證用專案__', '2026-11-02');
      select count(*) into n from public.project_tasks where project_id = v_proj;
      res := res || format('從範本建立專案：複製 3 項工作|%s', case when n = 3 then '✓' else '✗ 有 ' || n || ' 項' end);
      select count(*) into n from public.project_task_deps where project_id = v_proj;
      res := res || format('從範本建立專案：複製 2 條依賴|%s', case when n = 2 then '✓' else '✗ 有 ' || n || ' 條' end);
      select count(*) into n from public.project_task_deps d
        join public.project_tasks pt on pt.id = d.task_id
      where d.project_id = v_proj and pt.name = 'C' and d.lag_days = 2;
      res := res || format('從範本建立專案：間隔天數一起複製|%s', case when n = 1 then '✓' else '✗' end);
      select count(*) into n from public.project_tasks where project_id = v_proj and is_launch and name = 'B';
      res := res || format('從範本建立專案：發售標記一起複製|%s', case when n = 1 then '✓' else '✗' end);
    exception when others then
      res := res || ('從範本建立專案|✗ ' || sqlerrm);
    end;
    begin
      update public.project_tasks set actual_start = '2026-11-05', actual_end = '2026-11-03'
      where project_id = v_proj and name = 'A';
      get diagnostics n = row_count;
      if n = 0 then raise exception using errcode = 'VF002'; end if;
      raise exception using errcode = 'VF001';
    exception
      when sqlstate 'VF001'    then res := res || '擋下實際完成日早於開始日|✗ 沒擋住'::text;
      when sqlstate 'VF002'    then res := res || '擋下實際完成日早於開始日|✗ 沒有專案可測'::text;
      when check_violation     then res := res || '擋下實際完成日早於開始日|✓'::text;
      when others              then res := res || ('擋下實際完成日早於開始日|✗ 錯誤原因不對：' || sqlerrm);
    end;

    -- 5. 陌生人（另一個登入帳號）
    perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);

    select count(*) into n from public.templates where id = v_tpl;
    res := res || format('陌生人看不到你的範本|%s', case when n = 0 then '✓' else '✗ 看得到' end);
    select count(*) into n from public.template_tasks where template_id = v_tpl;
    res := res || format('陌生人看不到你的範本工作|%s', case when n = 0 then '✓' else '✗ 看得到' end);
    select count(*) into n from public.project_tasks where project_id = v_proj;
    res := res || format('陌生人看不到你的專案工作|%s', case when n = 0 then '✓' else '✗ 看得到' end);

    begin
      update public.templates set name = '被改了' where id = v_tpl;
      get diagnostics n = row_count;
      if n > 0 then raise exception using errcode = 'VF001'; end if;
      res := res || '陌生人改不了你的範本|✓'::text;
    exception
      when sqlstate 'VF001'       then res := res || '陌生人改不了你的範本|✗ 改得到'::text;
      when insufficient_privilege then res := res || '陌生人改不了你的範本|✓'::text;
      when others                 then res := res || ('陌生人改不了你的範本|✗ ' || sqlerrm);
    end;
    begin
      delete from public.projects where id = v_proj;
      get diagnostics n = row_count;
      if n > 0 then raise exception using errcode = 'VF001'; end if;
      res := res || '陌生人刪不了你的專案|✓'::text;
    exception
      when sqlstate 'VF001'       then res := res || '陌生人刪不了你的專案|✗ 刪得到'::text;
      when insufficient_privilege then res := res || '陌生人刪不了你的專案|✓'::text;
      when others                 then res := res || ('陌生人刪不了你的專案|✗ ' || sqlerrm);
    end;
    begin
      insert into public.template_tasks (template_id, owner_id, name, duration) values (v_tpl, me, '偷塞', 1);
      raise exception using errcode = 'VF001';
    exception
      when sqlstate 'VF001'       then res := res || '陌生人不能冒用你的身分新增|✗ 沒擋住'::text;
      when insufficient_privilege then res := res || '陌生人不能冒用你的身分新增|✓'::text;
      when others                 then res := res || ('陌生人不能冒用你的身分新增|✗ 錯誤原因不對：' || sqlerrm);
    end;
    begin
      insert into public.template_tasks (template_id, owner_id, name, duration) values (v_tpl, stranger, '偷塞', 1);
      raise exception using errcode = 'VF001';
    exception
      when sqlstate 'VF001'          then res := res || '陌生人不能把工作掛到你的範本|✗ 沒擋住'::text;
      when foreign_key_violation     then res := res || '陌生人不能把工作掛到你的範本|✓'::text;
      when others                    then res := res || ('陌生人不能把工作掛到你的範本|✗ 錯誤原因不對：' || sqlerrm);
    end;

    -- 6. 未登入訪客實際試讀（補強第 1 段的權限檢查）
    reset role;
    perform set_config('request.jwt.claims', '', true);
    foreach t in array tables loop
      begin
        set local role anon;
        execute format('select count(*) from public.%I', t) into n;
        raise exception using errcode = 'VF001';
      exception
        when sqlstate 'VF001'       then res := res || format('未登入訪客實際讀不到：%s|✗ 讀得到', t);
        when insufficient_privilege then res := res || format('未登入訪客實際讀不到：%s|✓', t);
        when others                 then res := res || format('未登入訪客實際讀不到：%s|✗ %s', t, sqlerrm);
      end;
    end loop;

    -- 故意丟出錯誤，讓上面所有測試資料全部復原
    raise exception using errcode = 'VF000', message = '__ROLLBACK__';
  exception
    when sqlstate 'VF000' then null;   -- 預期中的復原
    when others then
      res := res || ('驗證中途發生非預期錯誤|✗ ' || sqlerrm);
  end;

  -- 7. 確認測試資料已清乾淨
  select count(*) into n from public.templates where name = '__驗證用範本__';
  res := res || format('測試資料已全部復原|%s', case when n = 0 then '✓' else '✗ 還留著' end);

  insert into _verify
  select i, split_part(res[i], '|', 1), split_part(res[i], '|', 2)
  from generate_subscripts(res, 1) as i;
end;
$$;

select no as "#", item as "檢查項目", result as "結果" from _verify order by no;
