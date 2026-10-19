// =====================================================================
// 工作時程規劃器：日期計算引擎
// 規則依據：docs/計算規則.md（程式註解中的 R1、R2… 對應文件編號）
//
// 這個檔案是「純函式」：不碰畫面、不碰資料庫、不讀系統時間。
// 同樣的輸入，在任何電腦、任何時區都會得到同樣的結果。
// =====================================================================

// ---------------------------------------------------------------------
// 1. 日期工具（R1）
//    日期在內部轉成「天數」（1970-01-01 = 0）做加減，
//    換算公式來自 Howard Hinnant 的 days_from_civil 演算法，
//    完全不使用 JavaScript 的 Date 物件，所以不會有時區差一天的問題。
// ---------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_SCAN = 3660; // 找下一個工作天最多往後找 10 年，避免假日表設錯造成無限迴圈

export class ScheduleError extends Error {
  constructor(code, message, taskIds = []) {
    super(message);
    this.code = code;
    this.taskIds = taskIds;
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' → 天數。格式錯或日期不存在（例如 2026-02-30）會丟出錯誤。 */
export function toDayNum(s) {
  const m = typeof s === 'string' ? DATE_RE.exec(s) : null;
  if (!m) throw new ScheduleError('INVALID_DATE', `日期格式錯誤：${s}（應為 YYYY-MM-DD）`);
  let y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  y -= mo <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const z = era * 146097 + doe - 719468;
  // 反算回字串比對，擋掉 2026-02-30、2026-13-01 這類不存在的日期
  if (mo < 1 || mo > 12 || d < 1 || fromDayNum(z) !== s) {
    throw new ScheduleError('INVALID_DATE', `日期不存在：${s}`);
  }
  return z;
}

/** 天數 → 'YYYY-MM-DD' */
export function fromDayNum(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  let y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  if (m <= 2) y += 1;
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

/** 星期幾：0 = 週日 … 6 = 週六（1970-01-01 是週四） */
export function weekday(z) {
  return (((z + 4) % 7) + 7) % 7;
}

/** 兩個日期相差幾個日曆天（b − a） */
export function diffDays(a, b) {
  return toDayNum(b) - toDayNum(a);
}

function yearOf(z) {
  return Number(fromDayNum(z).slice(0, 4));
}

// ---------------------------------------------------------------------
// 2. 工作日曆（R2、R3）
// ---------------------------------------------------------------------

/**
 * 建立工作日曆。
 * @param {object} opts
 * @param {Array<{date:string,type:'off'|'workday'}>} opts.holidays
 *        type 'off' = 放假；'workday' = 補班
 * @param {number[]} opts.coveredYears 已匯入假日資料的年份（用來發出 R23 警告）
 */
export function createCalendar({ holidays = [], coveredYears = [] } = {}) {
  const off = new Set();
  const work = new Set();
  for (const h of holidays) {
    const z = toDayNum(h.date);
    if (h.type === 'off') off.add(z);
    else if (h.type === 'workday') work.add(z);
    else throw new ScheduleError('INVALID_HOLIDAY', `假日類型錯誤：${h.date} ${h.type}`);
  }
  return {
    isWorkday(z) {
      if (work.has(z)) return true; // 補班優先
      if (off.has(z)) return false;
      const w = weekday(z);
      return w !== 0 && w !== 6;
    },
    coveredYears: new Set(coveredYears.map(Number)),
  };
}

/** z 若是工作天就回傳 z，否則往後找第一個工作天 */
export function nextWorkday(cal, z) {
  for (let i = 0; i < MAX_SCAN; i++) {
    if (cal.isWorkday(z + i)) return z + i;
  }
  throw new ScheduleError('NO_WORKDAY', `${fromDayNum(z)} 之後 10 年內找不到工作天，請檢查假日表`);
}

/** 從 start 起算第 n 個工作天（start 若是工作天就算第 1 天）。n ≥ 1 */
export function addWorkdays(cal, start, n) {
  let z = nextWorkday(cal, start);
  for (let c = 1; c < n; c++) z = nextWorkday(cal, z + 1);
  return z;
}

/** from 之後（不含 from）的第 n 個工作天。n = 0 時回傳 from */
function workdaysAfter(cal, from, n) {
  let z = from;
  for (let c = 0; c < n; c++) z = nextWorkday(cal, z + 1);
  return z;
}

// ---------------------------------------------------------------------
// 3. 輸入檢查（R22）
// ---------------------------------------------------------------------

const DAY_TYPES = new Set(['workday', 'calendar']);

function isNonNegInt(v) {
  return Number.isInteger(v) && v >= 0;
}

function optDate(v, label, task, errors) {
  if (v === null || v === undefined || v === '') return null;
  try {
    return toDayNum(v);
  } catch (e) {
    errors.push(err('INVALID_DATE', `「${task.name}」的${label}格式錯誤：${v}`, [task.id]));
    return null;
  }
}

function err(code, message, taskIds = []) {
  return { code, message, taskIds };
}

function normalize(input, errors) {
  const byId = new Map();
  const list = [];
  for (const raw of input.tasks || []) {
    const id = String(raw.id ?? '');
    const name = raw.name ?? id;
    const t = {
      id,
      name,
      duration: raw.duration,
      dayType: raw.dayType ?? 'workday',
      buffer: raw.buffer ?? 0,
      deps: [],
      isLaunch: Boolean(raw.isLaunch),
    };
    if (!id) {
      errors.push(err('INVALID_INPUT', `有工作沒有 id（${name}）`));
      continue;
    }
    if (byId.has(id)) {
      errors.push(err('DUPLICATE_ID', `工作 id 重複：${id}`, [id]));
      continue;
    }
    if (!isNonNegInt(t.duration)) errors.push(err('INVALID_DURATION', `「${name}」的天數必須是 0 或正整數`, [id]));
    if (!isNonNegInt(t.buffer)) errors.push(err('INVALID_DURATION', `「${name}」的緩衝天數必須是 0 或正整數`, [id]));
    if (!DAY_TYPES.has(t.dayType)) errors.push(err('INVALID_DAY_TYPE', `「${name}」的計算方式必須是 workday 或 calendar`, [id]));
    t.earliestStart = optDate(raw.earliestStart, '指定最早開始日', t, errors);
    t.actualStart = optDate(raw.actualStart, '實際開始日', t, errors);
    t.actualEnd = optDate(raw.actualEnd, '實際完成日', t, errors);
    if (t.actualStart !== null && t.actualEnd !== null && t.actualEnd < t.actualStart) {
      errors.push(err('ACTUAL_END_BEFORE_START', `「${name}」的實際完成日早於實際開始日`, [id]));
    }
    t.rawDeps = raw.deps || [];
    byId.set(id, t);
    list.push(t);
  }

  for (const t of list) {
    const seen = new Set();
    for (const d of t.rawDeps) {
      const depId = String(typeof d === 'object' ? d.id : d);
      const lag = typeof d === 'object' ? (d.lag ?? 0) : 0;
      if (depId === t.id) {
        errors.push(err('SELF_DEPENDENCY', `「${t.name}」不能依賴自己`, [t.id]));
        continue;
      }
      if (!byId.has(depId)) {
        errors.push(err('UNKNOWN_DEPENDENCY', `「${t.name}」的前置工作不存在（${depId}）`, [t.id]));
        continue;
      }
      if (seen.has(depId)) {
        errors.push(err('DUPLICATE_DEPENDENCY', `「${t.name}」重複設定同一項前置工作`, [t.id]));
        continue;
      }
      if (!isNonNegInt(lag)) {
        errors.push(err('INVALID_DURATION', `「${t.name}」的間隔天數必須是 0 或正整數`, [t.id]));
        continue;
      }
      seen.add(depId);
      t.deps.push({ id: depId, lag });
    }
    delete t.rawDeps;
  }

  const launches = list.filter((t) => t.isLaunch);
  if (launches.length > 1) {
    errors.push(err('MULTIPLE_LAUNCH', `只能有一項工作標為「發售」，目前有 ${launches.length} 項`, launches.map((t) => t.id)));
  }
  return { list, byId };
}

/** 拓撲排序；有循環時回傳循環中的工作（只列真正繞圈的，不含被卡住的下游） */
function topoSort(list, byId) {
  const indeg = new Map(list.map((t) => [t.id, t.deps.length]));
  const children = new Map(list.map((t) => [t.id, []]));
  for (const t of list) for (const d of t.deps) children.get(d.id).push(t.id);
  const order = [];
  const queue = list.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const c of children.get(id)) {
      indeg.set(c, indeg.get(c) - 1);
      if (indeg.get(c) === 0) queue.push(c);
    }
  }
  if (order.length === list.length) return { order, cycle: [] };

  // 剩下的節點裡，能沿著前置工作繞回自己的才是循環成員
  const remaining = new Set(list.filter((t) => !order.includes(t.id)).map((t) => t.id));
  const cycle = [];
  for (const start of remaining) {
    const stack = byId.get(start).deps.map((d) => d.id);
    const visited = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (cur === start) {
        cycle.push(start);
        break;
      }
      if (visited.has(cur) || !remaining.has(cur)) continue;
      visited.add(cur);
      for (const d of byId.get(cur).deps) stack.push(d.id);
    }
  }
  return { order, cycle };
}

// ---------------------------------------------------------------------
// 4. 主程式
// ---------------------------------------------------------------------

/**
 * 計算整個專案的時程。
 *
 * @param {object} input
 * @param {string} input.projectStart 專案開工日 'YYYY-MM-DD'
 * @param {string|null} input.today   今天；傳 null 表示不套用 R15、R16（看原始計畫用）
 * @param {object} input.calendar     { holidays, coveredYears }
 * @param {Array} input.tasks
 *   每項工作：{ id, name, duration, dayType:'workday'|'calendar', buffer,
 *               deps:[{id, lag}], earliestStart, actualStart, actualEnd, isLaunch }
 *
 * @returns 成功：{ ok:true, tasks:{[id]:結果}, order, projectEnd, launchDate,
 *                  launchTaskId, criticalPath, warnings }
 *          失敗：{ ok:false, errors:[{code, message, taskIds}] }
 */
export function computeSchedule(input) {
  const errors = [];
  let cal, projectStartZ, todayZ;

  try {
    cal = createCalendar(input.calendar || {});
  } catch (e) {
    return { ok: false, errors: [err(e.code || 'INVALID_INPUT', e.message)] };
  }
  try {
    projectStartZ = toDayNum(input.projectStart);
  } catch (e) {
    errors.push(err('INVALID_DATE', `專案開工日格式錯誤：${input.projectStart}`));
  }
  todayZ = null;
  if (input.today !== null && input.today !== undefined) {
    try {
      todayZ = toDayNum(input.today);
    } catch (e) {
      errors.push(err('INVALID_DATE', `今天的日期格式錯誤：${input.today}`));
    }
  }

  const { list, byId } = normalize(input, errors);
  if (errors.length) return { ok: false, errors };

  const { order, cycle } = topoSort(list, byId);
  if (cycle.length) {
    const names = cycle.map((id) => `「${byId.get(id).name}」`).join('、');
    return { ok: false, errors: [err('CYCLE', `前置工作形成循環：${names}`, cycle)] };
  }

  const R = new Map(); // id → 計算中的結果（日期用天數）
  try {
    for (const id of order) R.set(id, scheduleOne(byId.get(id), R, cal, projectStartZ, todayZ));
  } catch (e) {
    return { ok: false, errors: [err(e.code || 'INTERNAL', e.message)] };
  }

  // R19 專案完成日
  let projectEndZ = -Infinity;
  for (const r of R.values()) projectEndZ = Math.max(projectEndZ, r.endZ);

  // R20 發售日
  const launchTask = list.find((t) => t.isLaunch) || null;
  const launchDateZ = launchTask ? R.get(launchTask.id).startZ : projectEndZ;

  // R21 關鍵路徑：從發售工作（或最晚結束的工作）沿著 drivers 往回追
  const roots = launchTask
    ? [launchTask.id]
    : list.filter((t) => R.get(t.id).endZ === projectEndZ).map((t) => t.id);
  const critical = new Set();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop();
    if (critical.has(id)) continue;
    critical.add(id);
    for (const d of R.get(id).drivers) stack.push(d);
  }

  // R23 假日資料涵蓋年份
  const missing = new Set();
  for (const r of R.values()) {
    for (let y = yearOf(r.startZ); y <= yearOf(r.endZ); y++) {
      if (!cal.coveredYears.has(y)) missing.add(y);
    }
  }
  const warnings = [];
  if (missing.size) {
    const years = [...missing].sort((a, b) => a - b);
    warnings.push({
      code: 'HOLIDAY_DATA_MISSING',
      years,
      message: `${years.join('、')} 年沒有假日資料，這些年份只扣除週末，國定假日未扣除`,
    });
  }

  // 輸出：天數轉回日期字串
  const tasks = {};
  const index = new Map(order.map((id, i) => [id, i]));
  for (const id of order) {
    const r = R.get(id);
    tasks[id] = {
      id,
      name: byId.get(id).name,
      start: fromDayNum(r.startZ),
      end: fromDayNum(r.endZ),
      workEnd: fromDayNum(r.workEndZ),
      isMilestone: r.isMilestone,
      status: r.status,
      startReason: r.startReason,
      endReason: r.endReason,
      drivers: r.drivers,
      startShifted: r.startShifted,
      endShifted: r.endShifted,
      isCritical: critical.has(id),
    };
  }
  const criticalPath = [...critical].sort(
    (a, b) => R.get(a).startZ - R.get(b).startZ || index.get(a) - index.get(b),
  );

  return {
    ok: true,
    tasks,
    order,
    projectEnd: fromDayNum(projectEndZ),
    launchDate: fromDayNum(launchDateZ),
    launchTaskId: launchTask ? launchTask.id : null,
    criticalPath,
    warnings,
  };
}

/** 計算單一工作的起訖。前置工作一定已經算好（拓撲排序保證）。 */
function scheduleOne(t, R, cal, projectStartZ, todayZ) {
  const isMilestone = t.duration === 0; // R7
  const isWorkday = t.dayType === 'workday';
  const done = t.actualEnd !== null;
  const started = t.actualStart !== null || done; // 已開始或已完成
  const status = done ? 'done' : t.actualStart !== null ? 'in_progress' : 'not_started';

  // --- 前置工作：算出最晚可以接手的日子（R8、R9、R10）---
  let candidate;
  let startReason;
  let drivers = [];
  if (t.deps.length) {
    let ready = -Infinity;
    for (const d of t.deps) {
      const p = R.get(d.id);
      // R10 間隔天數，單位跟著「這項工作」
      const r = d.lag > 0 ? (isWorkday ? workdaysAfter(cal, p.endZ, d.lag) : p.endZ + d.lag) : p.endZ;
      if (r > ready) {
        ready = r;
        drivers = [d.id];
      } else if (r === ready) {
        drivers.push(d.id);
      }
    }
    candidate = isMilestone ? ready : ready + 1; // R7 里程碑不加一天；R8 一般工作從隔天起算
    startReason = 'dependency';
  } else {
    candidate = projectStartZ; // R11
    startReason = 'project_start';
  }

  // --- R12 指定最早開始日 ---
  if (t.earliestStart !== null && t.earliestStart > candidate) {
    candidate = t.earliestStart;
    startReason = 'earliest_start';
    drivers = [];
  }

  // --- R15、R17 尚未開始的工作不得早於今天 ---
  if (!started && todayZ !== null && todayZ > candidate) {
    candidate = todayZ;
    startReason = 'today';
    drivers = [];
  }

  // --- 決定開始日 ---
  let startZ;
  let startShifted = false;
  if (t.actualStart !== null && !isMilestone) {
    startZ = t.actualStart; // R13
    startReason = 'actual';
    drivers = [];
  } else if (isMilestone && done) {
    startZ = t.actualEnd; // R17
    startReason = 'actual';
    drivers = [];
  } else if (isWorkday) {
    startZ = nextWorkday(cal, candidate); // R4、R7 遇非工作天順延
    startShifted = startZ !== candidate;
  } else {
    startZ = candidate; // R5 日曆天開始日不調整
  }
  // 只填了實際完成日、沒填實際開始日：開始日不晚於完成日
  if (done && startZ > t.actualEnd) startZ = t.actualEnd;

  // --- 決定結束日 ---
  let endZ;
  let workEndZ;
  let endReason = 'calculated';
  let endShifted = false;
  if (done) {
    endZ = t.actualEnd; // R14
    workEndZ = endZ;
    endReason = 'actual';
  } else if (isMilestone) {
    endZ = startZ;
    workEndZ = startZ;
  } else {
    const total = t.duration + t.buffer; // R6
    if (isWorkday) {
      workEndZ = addWorkdays(cal, startZ, t.duration); // R4
      endZ = addWorkdays(cal, startZ, total);
    } else {
      const raw = startZ + total - 1;
      endZ = nextWorkday(cal, raw); // R5 期限遇非工作天順延
      endShifted = endZ !== raw;
      // 沒有緩衝時，順延的天數算在工作本身；有緩衝時，工作部分到第 N 天為止
      workEndZ = t.buffer === 0 ? endZ : startZ + t.duration - 1;
    }
    // R16 進行中且預計結束日已過：結束日推到今天（非工作天再順延）
    if (t.actualStart !== null && todayZ !== null && todayZ > endZ) {
      endZ = nextWorkday(cal, todayZ);
      endShifted = endZ !== todayZ;
      endReason = 'today';
      workEndZ = endZ; // 已逾期，整段都算工作
    }
  }

  return { startZ, endZ, workEndZ, isMilestone, status, startReason, endReason, drivers, startShifted, endShifted };
}
