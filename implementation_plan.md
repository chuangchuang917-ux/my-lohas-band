# LOHAS 後端資料庫整合計畫 (Supabase/PostgreSQL)

本計畫旨在後端引入 **Supabase / PostgreSQL** 資料庫，採用 **「讀穿快取 (Read-Through Cache)」** 模式。

此架構的好處在於：**前端頁面完全不需做任何調整**（API 回傳格式維持不變），但後端能獲得極速的資料庫讀取速度與高擴充性。

## 使用者審查項目

> [!IMPORTANT]
> **資料庫連接配置 (.env)**
> 我們將使用 SQLAlchemy 連接資料庫。您需要在專案根目錄建立一個 `.env` 檔案，並填入您的 Supabase / PostgreSQL 連接字串（例如 `DATABASE_URL=postgresql://user:pass@host:port/dbname`）。我們在程式碼中會優先從環境變數讀取該設定，若未設定則自動 Fallback 到原本的 yfinance 即時讀取模式，確保系統不中斷。

---

## 預估變動

### 後端依賴新增

#### [MODIFY] [requirements.txt](file:///c:/Users/chuang/Desktop/antigravity/Lohas/requirements.txt)
1. 新增資料庫連線相關套件：
   - `sqlalchemy` (ORM 框架)
   - `psycopg2-binary` (PostgreSQL 連接驅動)
   - `python-dotenv` (讀取環境變數 `.env`)

---

### 後端資料庫架構與模型

#### [NEW] [database.py](file:///c:/Users/chuang/Desktop/antigravity/Lohas/database.py)
1. 建立 SQLAlchemy 資料庫連線引擎 (`engine`) 與會話生命週期管理。
2. 定義兩個核心資料表模型：
   - **`DailyPrice` (日 K 線收盤價表)**：
     - 欄位：`id (PK)`, `symbol (Indexed)`, `date (Date)`, `close (Float)`。
     - 複合唯一約束 (Unique Constraint)：`(symbol, date)`，防止重複寫入。
   - **`WeeklyPrice` (週 K 線表，用於樂活通道)**：
     - 欄位：`id (PK)`, `symbol (Indexed)`, `date (Date)`, `open`, `high`, `low`, `close`, `volume`。
     - 複合唯一約束：`(symbol, date)`。

---

### 讀穿快取邏輯整合

#### [MODIFY] [main.py](file:///c:/Users/chuang/Desktop/antigravity/Lohas/main.py)
1. 載入 `dotenv` 並引入資料庫模型。
2. 於 FastAPI 啟動時自動建立資料庫表（若尚未建立）。
3. 修改 `/api/lohas` 路由邏輯，改為 **Read-Through Cache 模式**：
   - **Step 1**：檢查資料庫中是否存在該 `symbol` 的歷史數據。
   - **Step 2**：
     - **快取命中 (Cache Hit)**：若存在且資料庫中的最新日期是「今日/昨日（工作日）」，代表資料充足，直接從資料庫極速讀取並返回。
     - **快取失效 (Cache Miss)**：若不存在或資料太舊，則呼叫 yfinance 下載完整 13.5 年歷史，將其「批次寫入 (Bulk Insert)」資料庫，然後計算並返回。
     *(這代表任何股票在被搜尋過一次後，此後所有人的搜尋都能享受資料庫的毫秒級速度！)*

---

### 資料同步工具

#### [NEW] [sync_db.py](file:///c:/Users/chuang/Desktop/antigravity/Lohas/sync_db.py)
1. 撰寫一個獨立的指令列同步腳本。
2. 可指定股票清單，自動執行初次的大批次歷史資料下載與寫入。
3. 此腳本未來可設定於 GitHub Actions 或本地 Cron 排程，每天收盤後定時執行更新。

---

## 驗證計劃

### 自動化測試
- 建立測試用的 SQLite 或本地 PostgreSQL 連線，驗證 `database.py` 的表格建立與 `sync_db.py` 的資料庫寫入正常。

### 手動驗證
1. 設定資料庫連接後，啟動 FastAPI。
2. 搜尋股票（如 `SPY`），確認第一次搜尋時有觸發快取失效（後端會下載並儲存），且圖表渲染正常。
3. 第二次搜尋同一股票，觀察後端日誌，確認資料是由資料庫直接讀取，且載入時間降低至 50ms 內。
