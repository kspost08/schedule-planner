// =====================================================================
// 計算引擎測試案例
// 每個案例的預期日期都是先依 docs/計算規則.md 人工推算，
// 再用另一套獨立程式驗算過。改規則時，先改這裡的預期值。
//
// 測試用假日表（固定、與真實日曆無關，更新真實假日資料不會影響測試）：
//   2026-11-11（三）放假　← 測試專用，不是真的國定假日
//   2026-11-14（六）補班
//   2027-01-01（五）元旦
//
// 2026 年 11 月對照：
//   一  二  三  四  五  六  日
//   02  03  04  05  06  07  08
//   09  10 [11] 12  13 (14) 15     [ ]=放假  ( )=補班
//   16  17  18  19  20  21  22
//   23  24  25  26  27  28  29
// =====================================================================

export const TEST_CALENDAR = {
  holidays: [
    { date: '2026-11-11', type: 'off' },
    { date: '2026-11-14', type: 'workday' },
    { date: '2027-01-01', type: 'off' },
  ],
  coveredYears: [2026, 2027],
};

/** 產生一項工作。d = 天數；o = 其他設定 */
function T(id, d, o = {}) {
  return { id, name: o.name || id, duration: d, dayType: o.cal ? 'calendar' : 'workday', ...o.extra, deps: o.deps || [] };
}
const dep = (id, lag = 0) => ({ id, lag });

export const cases = [
  // ---------------- 基本 ----------------
  {
    id: '01', group: '基本', title: '工作天 3 天，週一開工',
    input: { projectStart: '2026-11-02', tasks: [T('A', 3)] },
    expect: { tasks: { A: { start: '2026-11-02', end: '2026-11-04' } } },
  },
  {
    id: '02', group: '基本', title: '開工日是週日 → 順延到週一',
    input: { projectStart: '2026-11-01', tasks: [T('A', 3)] },
    expect: { tasks: { A: { start: '2026-11-02', end: '2026-11-04', startShifted: true } } },
  },
  {
    id: '03', group: '工作天', title: '跨週末',
    input: { projectStart: '2026-11-05', tasks: [T('A', 3)] },
    expect: { tasks: { A: { start: '2026-11-05', end: '2026-11-09' } } },
  },
  {
    id: '04', group: '工作天', title: '跨國定假日（跳過 11/11）',
    input: { projectStart: '2026-11-10', tasks: [T('A', 3)] },
    expect: { tasks: { A: { start: '2026-11-10', end: '2026-11-13' } } },
  },
  {
    id: '05', group: '工作天', title: '補班的週六算工作天',
    input: { projectStart: '2026-11-13', tasks: [T('A', 2)] },
    expect: { tasks: { A: { start: '2026-11-13', end: '2026-11-14' } } },
  },
  {
    id: '06', group: '工作天', title: '跨年（跳過元旦）',
    input: { projectStart: '2026-12-30', tasks: [T('A', 3)] },
    expect: { tasks: { A: { start: '2026-12-30', end: '2027-01-04' } } },
  },

  // ---------------- 日曆天 ----------------
  {
    id: '07', group: '日曆天', title: '週末、假日照算，最後一天是工作天',
    input: { projectStart: '2026-11-06', tasks: [T('A', 7, { cal: true })] },
    expect: { tasks: { A: { start: '2026-11-06', end: '2026-11-12', endShifted: false } } },
  },
  {
    id: '08', group: '日曆天', title: '最後一天是週六 → 順延到週一',
    input: { projectStart: '2026-11-04', tasks: [T('A', 4, { cal: true })] },
    expect: { tasks: { A: { start: '2026-11-04', end: '2026-11-09', endShifted: true } } },
  },
  {
    id: '09', group: '日曆天', title: '最後一天是國定假日 → 順延',
    input: { projectStart: '2026-11-09', tasks: [T('A', 3, { cal: true })] },
    expect: { tasks: { A: { start: '2026-11-09', end: '2026-11-12', endShifted: true } } },
  },
  {
    id: '10', group: '日曆天', title: '最後一天是補班的週六 → 不順延',
    input: { projectStart: '2026-11-12', tasks: [T('A', 3, { cal: true })] },
    expect: { tasks: { A: { start: '2026-11-12', end: '2026-11-14', endShifted: false } } },
  },
  {
    id: '11', group: '日曆天', title: '開始日是週六 → 不調整',
    input: { projectStart: '2026-11-07', tasks: [T('A', 3, { cal: true })] },
    expect: { tasks: { A: { start: '2026-11-07', end: '2026-11-09' } } },
  },

  // ---------------- 銜接 ----------------
  {
    id: '12', group: '銜接', title: '串連：後續工作從隔天開始',
    input: { projectStart: '2026-11-02', tasks: [T('A', 3), T('B', 2, { deps: [dep('A')] })] },
    expect: { tasks: { B: { start: '2026-11-05', end: '2026-11-06', startReason: 'dependency' } } },
  },
  {
    id: '13', group: '銜接', title: '前置週五結束 → 後續週一開始',
    input: { projectStart: '2026-11-02', tasks: [T('A', 5), T('B', 1, { deps: [dep('A')] })] },
    expect: { tasks: { A: { end: '2026-11-06' }, B: { start: '2026-11-09', end: '2026-11-09' } } },
  },
  {
    id: '14', group: '銜接', title: '多項前置取最晚',
    input: { projectStart: '2026-11-02', tasks: [T('A', 3), T('B', 5), T('C', 1, { deps: [dep('A'), dep('B')] })] },
    expect: { tasks: { C: { start: '2026-11-09', drivers: ['B'] } } },
  },
  {
    id: '15', group: '銜接', title: '間隔 2 工作天',
    input: { projectStart: '2026-11-02', tasks: [T('A', 3), T('B', 1, { deps: [dep('A', 2)] })] },
    expect: { tasks: { A: { end: '2026-11-04' }, B: { start: '2026-11-09' } } },
  },
  {
    id: '16', group: '銜接', title: '日曆天工作的間隔用日曆天，結束遇週日順延',
    input: { projectStart: '2026-11-02', tasks: [T('A', 3), T('B', 2, { cal: true, deps: [dep('A', 2)] })] },
    expect: { tasks: { B: { start: '2026-11-07', end: '2026-11-09', endShifted: true } } },
  },
  {
    id: '17', group: '銜接', title: '日曆天接工作天',
    input: { projectStart: '2026-11-04', tasks: [T('A', 4, { cal: true }), T('B', 1, { deps: [dep('A')] })] },
    expect: { tasks: { A: { end: '2026-11-09' }, B: { start: '2026-11-10' } } },
  },
  {
    id: '18', group: '銜接', title: '工作天接日曆天（從週六開始）',
    input: { projectStart: '2026-11-02', tasks: [T('A', 5), T('B', 3, { cal: true, deps: [dep('A')] })] },
    expect: { tasks: { B: { start: '2026-11-07', end: '2026-11-09' } } },
  },

  // ---------------- 緩衝與里程碑 ----------------
  {
    id: '19', group: '緩衝', title: '工作天 3 天 + 緩衝 2 天',
    input: { projectStart: '2026-11-02', tasks: [T('A', 3, { extra: { buffer: 2 } }), T('B', 1, { deps: [dep('A')] })] },
    expect: { tasks: { A: { workEnd: '2026-11-04', end: '2026-11-06' }, B: { start: '2026-11-09' } } },
  },
  {
    id: '20', group: '緩衝', title: '日曆天 3 天 + 緩衝 2 天',
    input: { projectStart: '2026-11-02', tasks: [T('A', 3, { cal: true, extra: { buffer: 2 } })] },
    expect: { tasks: { A: { workEnd: '2026-11-04', end: '2026-11-06' } } },
  },
  {
    id: '21', group: '里程碑', title: '里程碑在前置工作結束當天',
    input: { projectStart: '2026-11-02', tasks: [T('A', 5), T('M', 0, { deps: [dep('A')] }), T('B', 1, { deps: [dep('M')] })] },
    expect: { tasks: { M: { start: '2026-11-06', end: '2026-11-06', isMilestone: true }, B: { start: '2026-11-09' } } },
  },
  {
    id: '22', group: '里程碑', title: '沒有前置的里程碑在開工日（遇週日順延）',
    input: { projectStart: '2026-11-01', tasks: [T('M', 0)] },
    expect: { tasks: { M: { start: '2026-11-02', end: '2026-11-02' } } },
  },

  // ---------------- 指定最早開始日 ----------------
  {
    id: '23', group: '指定日期', title: '指定最早開始日晚於前置完成',
    input: { projectStart: '2026-11-02', tasks: [T('A', 3, { extra: { earliestStart: '2026-11-05' } })] },
    expect: { tasks: { A: { start: '2026-11-05', end: '2026-11-09', startReason: 'earliest_start' } } },
  },
  {
    id: '24', group: '指定日期', title: '指定最早開始日早於前置完成 → 照前置',
    input: { projectStart: '2026-11-02', tasks: [T('A', 5), T('B', 1, { deps: [dep('A')], extra: { earliestStart: '2026-11-03' } })] },
    expect: { tasks: { B: { start: '2026-11-09', startReason: 'dependency' } } },
  },

  // ---------------- 今天（R15、R16）----------------
  {
    id: '25', group: '今天', title: '原定日期已過、尚未開始 → 從今天起算，後面順延',
    input: { projectStart: '2026-11-02', today: '2026-11-10', tasks: [T('A', 3), T('B', 1, { deps: [dep('A')] })] },
    // B 從 11/14 開始：11/14 是補班日，算工作天
    expect: { tasks: { A: { start: '2026-11-10', end: '2026-11-13', startReason: 'today' }, B: { start: '2026-11-14' } } },
  },
  {
    id: '26', group: '今天', title: '指定最早開始日已過 → 一樣從今天起算',
    input: { projectStart: '2026-11-02', today: '2026-11-10', tasks: [T('A', 3, { extra: { earliestStart: '2026-11-03' } })] },
    expect: { tasks: { A: { start: '2026-11-10', startReason: 'today' } } },
  },
  {
    id: '27', group: '今天', title: '今天是週日，尚未開始 → 週一開始',
    input: { projectStart: '2026-11-02', today: '2026-11-08', tasks: [T('A', 1)] },
    expect: { tasks: { A: { start: '2026-11-09', startReason: 'today', startShifted: true } } },
  },
  {
    id: '28', group: '今天', title: '開工日在未來 → 不受今天影響',
    input: { projectStart: '2026-11-09', today: '2026-11-02', tasks: [T('A', 2)] },
    expect: { tasks: { A: { start: '2026-11-09', startReason: 'project_start' } } },
  },
  {
    id: '29', group: '今天', title: '進行中且已逾期 → 結束日推到今天',
    input: { projectStart: '2026-11-02', today: '2026-11-10', tasks: [T('A', 3, { extra: { actualStart: '2026-11-02' } }), T('B', 1, { deps: [dep('A')] })] },
    expect: { tasks: { A: { start: '2026-11-02', end: '2026-11-10', endReason: 'today', status: 'in_progress' }, B: { start: '2026-11-12' } } },
  },
  {
    id: '30', group: '今天', title: '進行中已逾期、今天是週日 → 結束日週一',
    input: { projectStart: '2026-11-02', today: '2026-11-08', tasks: [T('A', 3, { extra: { actualStart: '2026-11-02' } })] },
    expect: { tasks: { A: { end: '2026-11-09', endReason: 'today' } } },
  },
  {
    id: '31', group: '今天', title: '進行中、還沒逾期 → 照天數計算',
    input: { projectStart: '2026-11-02', today: '2026-11-03', tasks: [T('A', 3, { extra: { actualStart: '2026-11-02' } })] },
    expect: { tasks: { A: { end: '2026-11-04', endReason: 'calculated' } } },
  },
  {
    id: '32', group: '今天', title: '不傳今天（看原始計畫）→ 不推',
    input: { projectStart: '2026-11-02', today: null, tasks: [T('A', 3)] },
    expect: { tasks: { A: { start: '2026-11-02' } } },
  },

  // ---------------- 實際日期 ----------------
  {
    id: '33', group: '實際進度', title: '提早完成 → 後續提前',
    input: { projectStart: '2026-11-02', today: '2026-11-04', tasks: [T('A', 5, { extra: { actualStart: '2026-11-02', actualEnd: '2026-11-04' } }), T('B', 1, { deps: [dep('A')] })] },
    expect: { tasks: { A: { end: '2026-11-04', endReason: 'actual', status: 'done' }, B: { start: '2026-11-05' } } },
  },
  {
    id: '34', group: '實際進度', title: '延誤完成 → 後續順延（跳過 11/11）',
    input: { projectStart: '2026-11-02', today: '2026-11-10', tasks: [T('A', 5, { extra: { actualStart: '2026-11-02', actualEnd: '2026-11-10' } }), T('B', 1, { deps: [dep('A')] })] },
    expect: { tasks: { B: { start: '2026-11-12' } } },
  },
  {
    id: '35', group: '實際進度', title: '前置還沒完成就先開始 → 以實際開始日為準',
    input: { projectStart: '2026-11-02', today: '2026-11-04', tasks: [T('A', 5), T('B', 2, { deps: [dep('A')], extra: { actualStart: '2026-11-04' } })] },
    expect: { tasks: { B: { start: '2026-11-04', end: '2026-11-05', startReason: 'actual' } } },
  },
  {
    id: '36', group: '實際進度', title: '里程碑未達成、日期已過 → 推到今天',
    input: { projectStart: '2026-11-02', today: '2026-11-10', tasks: [T('A', 5, { extra: { actualStart: '2026-11-02', actualEnd: '2026-11-06' } }), T('M', 0, { deps: [dep('A')] })] },
    expect: { tasks: { M: { start: '2026-11-10', startReason: 'today' } } },
  },
  {
    id: '37', group: '實際進度', title: '里程碑已達成 → 以實際日期為準',
    input: { projectStart: '2026-11-02', today: '2026-11-10', tasks: [T('A', 3), T('M', 0, { deps: [dep('A')], extra: { actualEnd: '2026-11-05' } }), T('B', 1, { deps: [dep('M')] })] },
    expect: { tasks: { M: { start: '2026-11-05', end: '2026-11-05', startReason: 'actual' }, B: { start: '2026-11-10' } } },
  },

  // ---------------- 發售日、關鍵路徑 ----------------
  {
    id: '38', group: '關鍵路徑', title: '並行時只有較長的那條是關鍵路徑',
    input: { projectStart: '2026-11-02', tasks: [T('A', 3), T('B', 5), T('C', 1, { deps: [dep('A'), dep('B')] })] },
    expect: { criticalPath: ['B', 'C'], tasks: { A: { isCritical: false } } },
  },
  {
    id: '39', group: '關鍵路徑', title: '兩條一樣長 → 都是關鍵路徑',
    input: { projectStart: '2026-11-02', tasks: [T('A', 5), T('B', 5), T('C', 1, { deps: [dep('A'), dep('B')] })] },
    expect: { criticalPath: ['A', 'B', 'C'] },
  },
  {
    id: '40', group: '發售日', title: '販售後面還有庫存處理 → 發售日 ≠ 專案完成日',
    input: {
      projectStart: '2026-11-02',
      tasks: [
        T('design', 5, { name: '設計' }),
        T('sale', 10, { name: '販售', deps: [dep('design')], extra: { isLaunch: true } }),
        T('stock', 5, { name: '庫存處理', deps: [dep('sale')] }),
      ],
    },
    expect: {
      launchDate: '2026-11-09', launchTaskId: 'sale', projectEnd: '2026-11-27',
      criticalPath: ['design', 'sale'],
      tasks: { sale: { end: '2026-11-20' }, stock: { start: '2026-11-23', isCritical: false } },
    },
  },
  {
    id: '41', group: '發售日', title: '沒有標記發售 → 發售日 = 專案完成日',
    input: { projectStart: '2026-11-02', tasks: [T('A', 3), T('B', 2, { deps: [dep('A')] })] },
    expect: { launchDate: '2026-11-06', projectEnd: '2026-11-06', launchTaskId: null },
  },
  {
    id: '42', group: '關鍵路徑', title: '開始日由今天決定 → 關鍵路徑追到這裡為止',
    input: { projectStart: '2026-11-02', today: '2026-11-10', tasks: [T('A', 3, { extra: { actualStart: '2026-11-02', actualEnd: '2026-11-04' } }), T('B', 1, { deps: [dep('A')] })] },
    expect: { criticalPath: ['B'] },
  },

  // ---------------- 錯誤 ----------------
  {
    id: '43', group: '錯誤', title: '循環依賴（只列出繞圈的 A、B，不含下游 C）',
    input: { projectStart: '2026-11-02', tasks: [T('A', 1, { deps: [dep('B')] }), T('B', 1, { deps: [dep('A')] }), T('C', 1, { deps: [dep('B')] })] },
    expect: { errorCodes: ['CYCLE'], errorTaskIds: ['A', 'B'] },
  },
  {
    id: '44', group: '錯誤', title: '依賴自己',
    input: { projectStart: '2026-11-02', tasks: [T('A', 1, { deps: [dep('A')] })] },
    expect: { errorCodes: ['SELF_DEPENDENCY'] },
  },
  {
    id: '45', group: '錯誤', title: '前置工作不存在',
    input: { projectStart: '2026-11-02', tasks: [T('A', 1, { deps: [dep('X')] })] },
    expect: { errorCodes: ['UNKNOWN_DEPENDENCY'] },
  },
  {
    id: '46', group: '錯誤', title: '天數為負數、小數',
    input: { projectStart: '2026-11-02', tasks: [T('A', -1), T('B', 1.5)] },
    expect: { errorCodes: ['INVALID_DURATION', 'INVALID_DURATION'] },
  },
  {
    id: '47', group: '錯誤', title: '不存在的日期 2026-02-30',
    input: { projectStart: '2026-02-30', tasks: [T('A', 1)] },
    expect: { errorCodes: ['INVALID_DATE'] },
  },
  {
    id: '48', group: '錯誤', title: '實際完成日早於實際開始日',
    input: { projectStart: '2026-11-02', tasks: [T('A', 3, { extra: { actualStart: '2026-11-05', actualEnd: '2026-11-03' } })] },
    expect: { errorCodes: ['ACTUAL_END_BEFORE_START'] },
  },
  {
    id: '49', group: '錯誤', title: '兩項工作都標為發售',
    input: { projectStart: '2026-11-02', tasks: [T('A', 1, { extra: { isLaunch: true } }), T('B', 1, { extra: { isLaunch: true } })] },
    expect: { errorCodes: ['MULTIPLE_LAUNCH'] },
  },

  // ---------------- 警告 ----------------
  {
    id: '50', group: '警告', title: '算到 2028 年，沒有假日資料 → 警告但照算',
    input: { projectStart: '2027-12-28', tasks: [T('A', 5)] },
    expect: { tasks: { A: { start: '2027-12-28', end: '2028-01-03' } }, warningYears: [2028] },
  },
  {
    id: '51', group: '警告', title: '資料完整 → 沒有警告',
    input: { projectStart: '2026-11-02', tasks: [T('A', 3)] },
    expect: { warningYears: [] },
  },
];
