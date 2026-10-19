# 工作時程規劃器

填入工作項目、天數和前後順序，自動算出每項工作的起訖日與產品發售日。
扣除週末與國定假日，並可追蹤實際進度。

- 前端：GitHub Pages（純 HTML + JavaScript，不需要建置）
- 資料庫：Supabase

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `docs/計算規則.md` | 日期計算規則，所有程式和測試都以這份為準 |
| `js/scheduler.js` | 日期計算引擎（純函式，不碰畫面和資料庫） |
| `tests/cases.js` | 51 個測試案例與預期結果 |
| `tests/check.js` | 比對測試結果（測試頁和 GitHub Actions 共用） |
| `tests/run-node.mjs` | GitHub Actions 用的測試執行器 |
| `tests.html` | 測試頁，用瀏覽器打開就會跑全部測試 |
| `.github/workflows/test.yml` | 每次 commit 自動在三種時區跑測試 |
| `supabase/01_schema.sql` | 建表、防呆規則、RLS 安全規則 |
| `supabase/02_verify.sql` | 驗證資料庫設定（44 項檢查） |
| `package.json` | 讓 GitHub Actions 的 Node 用 ES module 讀取程式 |

## 上線步驟

### A. GitHub

1. 建立新的 repository。
2. **Add file → Upload files**，把解壓縮後資料夾裡的所有內容拖進去，commit。
   - ⚠️ `.github` 是隱藏資料夾，Mac 的 Finder 預設看不到，拖曳時可能漏掉。
     上傳後確認 repo 裡有 `.github/workflows/test.yml`；沒有的話，用
     **Add file → Create new file**，檔名輸入 `.github/workflows/test.yml`，再貼上檔案內容。
3. **Settings → Pages**：Source 選 `Deploy from a branch`，Branch 選 `main`、資料夾選 `/ (root)`。
4. 等一兩分鐘，打開 `https://你的帳號.github.io/repo名稱/tests.html`，應該顯示「✓ 全部通過（51 / 51）」。
5. 到 **Actions** 分頁，應該看到「計算引擎測試」三個時區都是綠色 ✓。

### B. Supabase

1. 建立新專案。
2. **Authentication → Users → Add user → Create new user**：輸入你的 email 和密碼，勾選自動確認。
3. 在 Authentication 的設定中，**關閉「Allow new users to sign up」**。
   這個工具只有你自己用，關掉後別人就無法註冊帳號。
4. **SQL Editor**：貼上 `supabase/01_schema.sql` 全部內容 → Run。
5. **SQL Editor**：貼上 `supabase/02_verify.sql` 全部內容 → Run。結果表格每一列都應該是 ✓。
6. **Advisors → Security Advisor**：確認沒有紅色項目。

> `01_schema.sql` 需要 Postgres 15 以上（Supabase 新專案都符合）。
> 若出現 `syntax error at or near "("` 指向 `on delete set null (template_id)`，請告訴我，我改成相容寫法。

## 修改規則的流程

1. 先改 `docs/計算規則.md`
2. 再改 `tests/cases.js` 的預期結果
3. 最後改 `js/scheduler.js`，直到測試頁全部通過
