// =====================================================================
// 比對單一測試案例的結果。瀏覽器測試頁和 GitHub Actions 共用這支。
// 只比對案例裡有寫到的欄位，沒寫的不檢查。
// =====================================================================

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @returns {{ pass:boolean, diffs:string[], result:object }}
 */
export function runCase(c, computeSchedule, calendar) {
  const diffs = [];
  let result;
  try {
    result = computeSchedule({ today: null, calendar, ...c.input });
  } catch (e) {
    return { pass: false, diffs: [`程式拋出例外：${e.message}`], result: null };
  }
  const exp = c.expect;

  // 預期錯誤
  if (exp.errorCodes) {
    if (result.ok) {
      diffs.push(`預期錯誤 ${exp.errorCodes.join(', ')}，但計算成功`);
    } else {
      const got = result.errors.map((e) => e.code);
      if (!same(got, exp.errorCodes)) diffs.push(`錯誤代碼：預期 ${exp.errorCodes.join(', ')}，實際 ${got.join(', ')}`);
      if (exp.errorTaskIds) {
        const ids = result.errors.flatMap((e) => e.taskIds);
        if (!same(ids, exp.errorTaskIds)) diffs.push(`錯誤相關工作：預期 ${exp.errorTaskIds.join(', ')}，實際 ${ids.join(', ')}`);
      }
    }
    return { pass: diffs.length === 0, diffs, result };
  }

  if (!result.ok) {
    diffs.push(`預期成功，但出現錯誤：${result.errors.map((e) => e.message).join('；')}`);
    return { pass: false, diffs, result };
  }

  for (const [id, fields] of Object.entries(exp.tasks || {})) {
    const t = result.tasks[id];
    if (!t) {
      diffs.push(`找不到工作 ${id}`);
      continue;
    }
    for (const [k, v] of Object.entries(fields)) {
      if (!same(t[k], v)) diffs.push(`${id}.${k}：預期 ${JSON.stringify(v)}，實際 ${JSON.stringify(t[k])}`);
    }
  }
  for (const k of ['projectEnd', 'launchDate', 'launchTaskId', 'criticalPath']) {
    if (k in exp && !same(result[k], exp[k])) {
      diffs.push(`${k}：預期 ${JSON.stringify(exp[k])}，實際 ${JSON.stringify(result[k])}`);
    }
  }
  if (exp.warningYears) {
    const years = result.warnings.filter((w) => w.code === 'HOLIDAY_DATA_MISSING').flatMap((w) => w.years);
    if (!same(years, exp.warningYears)) diffs.push(`警告年份：預期 ${JSON.stringify(exp.warningYears)}，實際 ${JSON.stringify(years)}`);
  }
  return { pass: diffs.length === 0, diffs, result };
}
