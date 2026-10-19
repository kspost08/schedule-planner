// GitHub Actions 用的測試執行器：node tests/run-node.mjs
// 有任何案例失敗就回傳錯誤碼 1，讓 commit 旁邊出現紅色 ✕
import { computeSchedule } from '../js/scheduler.js';
import { cases, TEST_CALENDAR } from './cases.js';
import { runCase } from './check.js';

const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
console.log(`時區：${tz}，共 ${cases.length} 個案例\n`);

let failed = 0;
for (const c of cases) {
  const { pass, diffs } = runCase(c, computeSchedule, TEST_CALENDAR);
  console.log(`${pass ? '✓' : '✗'} ${c.id} [${c.group}] ${c.title}`);
  if (!pass) {
    failed++;
    for (const d of diffs) console.log(`    ${d}`);
  }
}

console.log(`\n通過 ${cases.length - failed} / ${cases.length}`);
process.exit(failed ? 1 : 0);
