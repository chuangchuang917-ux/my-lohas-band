# Walkthrough — LOHAS 樂活五線譜股價位階分析系統

> **交接文件**：本文件供接手的 AI Agent 或開發者閱讀，詳細記錄了所有已完成功能、技術決策與注意事項。請從頭閱讀後再動手。

---

## 一、專案概覽

**目標**：建立一套基於「樂活五線譜」理論的股價位階分析 Web App，支援台股、美股分析，並整合 Supabase PostgreSQL 作為讀穿快取資料庫，大幅提升載入速度。

**本地啟動方式**：
```bash
cd C:\Users\chuang\Desktop\antigravity\Lohas
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

**線上網址**：https://my-lohas-band-1.onrender.com/（Render 部署）

**線上資料庫**：Supabase（PostgreSQL），連線字串存於 `.env`（本地）與 Render 環境變數中：
```
DATABASE_URL=postgresql://postgres:3%26EvgSrW%23%2Cj%2Bq8%24@db.uimtxxsqyykfcqihcrdz.supabase.co:5432/postgres
```

---

## 二、專案目錄結構

```
Lohas/
├── main.py                      # 核心：FastAPI 路由、計算邏輯、快取層
├── database.py                  # SQLAlchemy ORM 模型與連線池設定
├── sync_db.py                   # CLI 批次同步工具（可排程執行）
├── requirements.txt             # 相依套件
├── .env                         # 資料庫連線字串（不上傳 git！）
├── .gitignore                   # 排除 .env、lohas.db、__pycache__ 等
├── static/
│   ├── index.html               # 前端頁面（含新增商品 Modal）
│   ├── app.js                   # 前端互動邏輯（ECharts + CRUD watchlist）
│   └── style.css                # 樣式
└── walkthrough.md               # 本文件
```

---

## 三、已完成功能清單

### 3.1 資料庫整合（`database.py` + `main.py`）

- ✅ SQLAlchemy 連接 Supabase PostgreSQL（讀取 `.env` 中的 `DATABASE_URL`）
- ✅ **PostgreSQL 連線池**：`pool_size=5`、`max_overflow=10`、`pool_recycle=300`（避免 Supabase 閒置斷線）
- ✅ 兩張資料表：
  - `daily_prices`：每日收盤價（`symbol`, `date`, `close_price`），用於計算五線譜與月均線
  - `weekly_prices`：每週 OHLCV（`symbol`, `date`, `open`, `high`, `low`, `close`, `volume`），用於計算樂活通道
  - 兩表均有 `(symbol, date)` 複合唯一索引，防止重複寫入

### 3.2 讀穿快取架構（`main.py`）

**`/api/lohas` 路由的三層快取邏輯：**

1. **記憶體快取（第一層）**：`LOHAS_DATA_CACHE`，TTL = **300 秒（5 分鐘）**。同一標的同一區間的第二次請求在 5 分鐘內直接從記憶體回傳，耗時 < 10ms。

2. **資料庫快取（第二層）**：`DB_ENABLED = True` 時，從 Supabase 讀取歷史資料（耗時 < 200ms）。若 DB 沒有該股，自動觸發 yfinance 下載並存入。

3. **yfinance 增量更新（第三層）**：由 `SYMBOL_LAST_UPDATE_CHECK` 控制，**每 30 分鐘**才查一次 yfinance 做增量同步。

### 3.3 股票分割自動重建

- 增量更新時，若偵測到 `Stock Splits > 0`，自動清空該股所有 DB 資料並重新下載 13.5 年歷史

### 3.4 盤中即時資料拼裝（Hybrid Real-time）

- 若資料庫最新日期 < 今天且目前盤中未收盤，額外查一次 `ticker.history(period="1d", auto_adjust=False)` 取得當日即時價，在記憶體中 append 到歷史序列（不寫入 DB）

### 3.5 即時商品監控面板（`/api/monitor`）

- 支援 **16 檔商品**（預設，可由使用者自訂）
- API 支援 `?symbols=...` 參數接收前端自訂清單
- 使用 **批次 SQL 查詢**（`WHERE symbol IN (...)` 一次拉全部），從 28 秒優化至 < 700ms
- 計算並回傳：價格、漲跌幅、五線譜位階（1-6）、樂活通道位階（1-4）

**預設 16 個商品**：
```python
MONITOR_ITEMS = [
    {"symbol": "GC=F",    "name": "黃金期貨"},
    {"symbol": "SI=F",    "name": "銀期貨"},
    {"symbol": "HG=F",    "name": "銅期貨"},
    {"symbol": "CL=F",    "name": "紐約輕原油"},
    {"symbol": "^GSPC",   "name": "標普500指數"},
    {"symbol": "^NDX",    "name": "納斯達克100"},
    {"symbol": "2330.TW", "name": "台積電"},
    {"symbol": "0050.TW", "name": "元大台灣50"},
    {"symbol": "^TWII",   "name": "台灣加權指數"},
    {"symbol": "FVNM",    "name": "越南ETF(FVNM)"},   # ^VNINDEX 在 yfinance 無效
    {"symbol": "^N225",   "name": "日本日經225"},
    {"symbol": "ZS=F",    "name": "大豆期貨"},
    {"symbol": "ZC=F",    "name": "玉米期貨"},
    {"symbol": "ZW=F",    "name": "小麥期貨"},
    {"symbol": "BTC-USD", "name": "比特幣"},
    {"symbol": "ETH-USD", "name": "以太幣"},
]
```

### 3.6 監控面板 CRUD（使用者自訂清單）

- ✅ **新增商品**：右上角「新增商品」按鈕 → Modal 輸入代碼 + 名稱 → 後端驗證 → 加入清單
- ✅ **刪除商品**：每列「🗑️」按鈕，確認後移除
- ✅ **改名商品**：每列「✏️」按鈕，prompt 輸入新名稱
- ✅ **拖曳排序**：每列右側「⠿」手把，拖曳調整順序
- ✅ **全部持久化**：自訂清單（`lohas_custom_watchlist`）與排序（`lohas_monitor_order`）皆存在 **瀏覽器 localStorage**，跨 session 保留

### 3.7 前端功能（`static/`）

- **兩個 Tab**：「即時商品監控」（預設）、「單檔量化分析」
- **預設分析區間**：**3.5 年**
- **點擊監控表格列**：自動切換到單檔分析 Tab 並觸發分析
- **VIX 恐慌指數**：圖表底部附加顯示

### 3.8 月均線計算修正（重要！）

> ⚠️ **此為重大修正，接手 Agent 必讀**

**正確定義**：
- 5年均線 = **60月均線**（60-month MA）
- 10年均線 = **120月均線**（120-month MA）

**正確計算方式**（目前 `main.py` 第 518 行起）：
```python
df_monthly = df['Close'].resample('ME').last().dropna()
ma_5y_monthly  = df_monthly.rolling(window=60,  min_periods=1).mean()
ma_10y_monthly = df_monthly.rolling(window=120, min_periods=1).mean()
ma_5y_full  = ma_5y_monthly.reindex(df.index, method='ffill')
ma_10y_full = ma_10y_monthly.reindex(df.index, method='ffill')
```

**驗算結果（2330.TW，2026年6月）**：

| 均線 | 修正後 | 看盤軟體參考值 |
|------|---|---|
| 5年均線（60月）| **891** | **891** ✅ |
| 10年均線（120月）| **593** | **593** ✅ |

**關鍵**：所有 `ticker.history()` 都已改為 `auto_adjust=False`（原始未還原股價），與台股看盤軟體一致。

### 3.9 資料庫資料重置記錄

舊的 DB 資料（還原後價格）已於 2026-06-19 清空重建。現在所有寫入 DB 的資料皆為未還原股價。

---

## 四、快取參數一覽表

| 參數 | 變數名稱（main.py）| 目前值 | 說明 |
|------|---------|------|------|
| 記憶體快取 TTL | `LOHAS_DATA_CACHE` | 300 秒 | 5 分鐘內同標的/區間直接回傳 |
| yfinance 同步間隔 | `SYMBOL_LAST_UPDATE_CHECK` | 1800 秒 | 30 分鐘內不重複查 yfinance |
| VIX 快取 TTL | `VIX_CACHE` | 1800 秒 | 以 period_years 為 key |
| DB 連線池大小 | `pool_size` (database.py) | 5 | 持久連線數 |
| DB 連線池最大溢出 | `max_overflow` (database.py) | 10 | 高峰時最多額外連線數 |
| DB 連線池回收 | `pool_recycle` (database.py) | 300 秒 | 避免 Supabase 閒置斷線 |

---

## 五、股票代碼標準化規則

```python
def standardize_symbol(symbol: str) -> str:
    sym = symbol.strip().upper()
    if sym.isdigit():     # 純數字 → 自動加 .TW（台股）
        sym = f"{sym}.TW"
    return sym
```

範例：`2330` → `2330.TW`、`spy` → `SPY`

---

## 六、效能優化歷史記錄

| 優化項目 | 優化前 | 優化後 |
|---------|--------|--------|
| 監控面板載入 | ~28 秒（16 次序列 DB 查詢）| < 700ms（2 次批次查詢）|
| 單檔重複分析（快取命中）| ~2-5 秒 | < 10ms |
| yfinance 同步頻率 | 每 2 分鐘 | 每 30 分鐘 |
| VIX 快取 | 10 分鐘，以精確日期為 key | 30 分鐘，以 period_years 為 key |
| DB 連線開銷 | 每次 TCP 握手 | 連線池持久保持 |

---

## 七、Render 部署說明

**線上網址**：https://my-lohas-band-1.onrender.com/

**部署流程**（已設定，每次 `git push` 自動部署）：
```bash
cd C:\Users\chuang\Desktop\antigravity\Lohas
git add .
git commit -m "說明本次修改內容"
git push origin main
```

**Render 環境變數（必須在 Render Dashboard 手動設定）**：
- `DATABASE_URL`：Supabase 連線字串（與 `.env` 相同）

**⚠️ 注意**：`.env` 不上傳 git，必須在 Render 的 Environment 頁面手動填入 `DATABASE_URL`。

---

## 八、已知問題與待辦

### ✅ 已完成（本 session）
- `sync_db.py` 已加上 `auto_adjust=False`
- 監控商品從 8 擴增至 16
- 監控面板新增 CRUD 功能（新增/刪除/改名/排序）
- `^VNINDEX` 無效，已替換為 `FVNM`（越南 ETF）

### 🟡 建議：預熱常用股票資料

清空 DB 後，建議執行批次同步讓常用股票提前存入 DB：
```bash
python sync_db.py
```

### 🟡 建議：GitHub Actions 每日排程

設定 `.github/workflows/db_sync.yml`，每日台股收盤後（UTC 14:00）自動執行 `sync_db.py`。

### 🟢 選做：Supabase 防休眠探活

Supabase 免費版若連續 7 天沒有請求會自動暫停。可在 GitHub Actions 加入每 3 天的 `SELECT 1` 探活 job。

---

## 九、相依套件

```
fastapi
uvicorn
numpy
pandas
yfinance
sqlalchemy
psycopg2-binary
python-dotenv
```


> **交接文件**：本文件供接手的 AI Agent 或開發者閱讀，詳細記錄了所有已完成功能、技術決策與注意事項。請從頭閱讀後再動手。

---

## 一、專案概覽

**目標**：建立一套基於「樂活五線譜」理論的股價位階分析 Web App，支援台股、美股分析，並整合 Supabase PostgreSQL 作為讀穿快取資料庫，大幅提升載入速度。

**本地啟動方式**：
```bash
cd C:\Users\chuang\Desktop\antigravity\Lohas
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

**線上資料庫**：Supabase（PostgreSQL），連線字串存於 `.env`：
```
DATABASE_URL=postgresql://postgres:3%26EvgSrW%23%2Cj%2Bq8%24@db.uimtxxsqyykfcqihcrdz.supabase.co:5432/postgres
```

---

## 二、專案目錄結構

```
Lohas/
├── main.py                      # 核心：FastAPI 路由、計算邏輯、快取層
├── database.py                  # SQLAlchemy ORM 模型與連線池設定
├── sync_db.py                   # CLI 批次同步工具（可排程執行）
├── requirements.txt             # 相依套件
├── .env                         # 資料庫連線字串（不應上傳 git）
├── lohas.db                     # 本地 SQLite 備用（開發測試用）
├── reset_db.py                  # 一次性清空 DB 腳本（已執行過，可忽略）
├── check_ma.py                  # 驗算月均線的一次性測試腳本（可忽略）
├── benchmark_lohas.py           # 效能基準測試腳本
├── static/
│   ├── index.html               # 前端頁面
│   ├── app.js                   # 前端互動邏輯（ECharts）
│   └── style.css                # 樣式
├── walkthrough.md               # 本文件
├── implementation_plan.md       # 原始設計規劃（歷史參考）
└── database_integration_design.md # 資料庫架構設計說明（歷史參考）
```

---

## 三、已完成功能清單

### 3.1 資料庫整合（`database.py` + `main.py`）

- ✅ SQLAlchemy 連接 Supabase PostgreSQL（讀取 `.env` 中的 `DATABASE_URL`）
- ✅ **PostgreSQL 連線池**：`pool_size=5`、`max_overflow=10`、`pool_recycle=300`（避免 Supabase 閒置斷線）
- ✅ 兩張資料表：
  - `daily_prices`：每日收盤價（`symbol`, `date`, `close_price`），用於計算五線譜與月均線
  - `weekly_prices`：每週 OHLCV（`symbol`, `date`, `open`, `high`, `low`, `close`, `volume`），用於計算樂活通道
  - 兩表均有 `(symbol, date)` 複合唯一索引，防止重複寫入

### 3.2 讀穿快取架構（`main.py`）

**`/api/lohas` 路由的三層快取邏輯：**

1. **記憶體快取（第一層）**：`LOHAS_DATA_CACHE`，TTL = **300 秒（5 分鐘）**。同一標的同一區間的第二次請求在 5 分鐘內直接從記憶體回傳，耗時 < 10ms。

2. **資料庫快取（第二層）**：`DB_ENABLED = True` 時，從 Supabase 讀取歷史資料（耗時 < 200ms）。若 DB 沒有該股，自動觸發 yfinance 下載並存入。

3. **yfinance 增量更新（第三層）**：由 `SYMBOL_LAST_UPDATE_CHECK` 控制，**每 30 分鐘**才查一次 yfinance 做增量同步。

### 3.3 股票分割自動重建

- 增量更新時，若偵測到 `Stock Splits > 0`，自動清空該股所有 DB 資料並重新下載 13.5 年歷史

### 3.4 盤中即時資料拼裝（Hybrid Real-time）

- 若資料庫最新日期 < 今天且目前盤中未收盤，額外查一次 `ticker.history(period="1d", auto_adjust=False)` 取得當日即時價，在記憶體中 append 到歷史序列（不寫入 DB）

### 3.5 即時商品監控面板（`/api/monitor`）

- 支援 8 檔商品：黃金期貨、銀期貨、銅期貨、原油期貨、標普500、納斯達克100、台積電、元大台灣50
- 使用 **批次 SQL 查詢**（`WHERE symbol IN (...)` 一次拉全部），從 28 秒優化至 < 700ms
- 計算並回傳：價格、漲跌幅、五線譜位階（1-6）、樂活通道位階（1-4）

### 3.6 前端功能（`static/`）

- **兩個 Tab**：
  - 「即時商品監控」：預設 Tab，表格顯示 8 檔商品位階
  - 「單檔量化分析」：搜尋欄、熱門代碼快捷按鈕、ECharts 圖表
- **預設分析區間**：**3.5 年**（前身為 1.5 年）
- **點擊監控表格列**：自動切換到單檔分析 Tab 並觸發分析
- **VIX 恐慌指數**：圖表底部附加顯示

### 3.7 月均線計算修正（重要！）

> ⚠️ **此為重大修正，接手 Agent 必讀**

**問題**：原本的 5年/10年均線是對「日線資料做 1825天/3650天 滾動平均」，結果數值偏低，與台股看盤軟體不符。

**正確定義**：
- 5年均線 = **60月均線**（60-month MA）
- 10年均線 = **120月均線**（120-month MA）

**正確計算方式**（目前 `main.py` 第 518 行起）：
```python
# 1. 日線 → 月底收盤價（resample）
df_monthly = df['Close'].resample('ME').last().dropna()

# 2. 月線滾動平均
ma_5y_monthly  = df_monthly.rolling(window=60,  min_periods=1).mean()
ma_10y_monthly = df_monthly.rolling(window=120, min_periods=1).mean()

# 3. reindex 回日線顯示（forward-fill）
ma_5y_full  = ma_5y_monthly.reindex(df.index, method='ffill')
ma_10y_full = ma_10y_monthly.reindex(df.index, method='ffill')
```

**驗算結果（2330.TW，2026年6月）**：

| 均線 | 修正前（還原後日線）| 修正後（未還原月線）| 看盤軟體參考值 |
|------|---|---|---|
| 5年均線（60月）| 864 | **891** | **891** ✅ |
| 10年均線（120月）| 560 | **593** | **593** ✅ |

**關鍵原因**：yfinance 預設 `auto_adjust=True`（除權息還原後股價）。台股看盤軟體使用**原始未還原股價**計算月均線。

**現在所有 `ticker.history()` 呼叫都已加上 `auto_adjust=False`。**

### 3.8 資料庫資料重置

由於月均線計算方式修正，舊的 DB 資料（還原後價格）已於 2026-06-19 清空：
- 清空前：daily_prices = 87,371 筆，weekly_prices = 18,289 筆
- 伺服器重啟後，搜尋任何股票時會自動重新下載並存入（使用 `auto_adjust=False`）

---

## 四、快取參數一覽表

| 參數 | 變數名稱（main.py）| 目前值 | 說明 |
|------|---------|------|------|
| 記憶體快取 TTL | `LOHAS_DATA_CACHE` | 300 秒 | 5 分鐘內同標的/區間直接回傳 |
| yfinance 同步間隔 | `SYMBOL_LAST_UPDATE_CHECK` | 1800 秒 | 30 分鐘內不重複查 yfinance |
| VIX 快取 TTL | `VIX_CACHE` | 1800 秒 | 以 period_years 為 key |
| DB 連線池大小 | `pool_size` (database.py) | 5 | 持久連線數 |
| DB 連線池最大溢出 | `max_overflow` (database.py) | 10 | 高峰時最多額外連線數 |
| DB 連線池回收 | `pool_recycle` (database.py) | 300 秒 | 避免 Supabase 閒置斷線 |

---

## 五、股票代碼標準化規則

```python
def standardize_symbol(symbol: str) -> str:
    sym = symbol.strip().upper()
    if sym.isdigit():     # 純數字 → 自動加 .TW（台股）
        sym = f"{sym}.TW"
    return sym
```

範例：`2330` → `2330.TW`、`spy` → `SPY`

---

## 六、`/api/monitor` 監控面板商品清單

位於 `main.py` 的 `MONITOR_ITEMS` 列表：

```python
MONITOR_ITEMS = [
    {"symbol": "GC=F",   "name": "黃金期貨"},
    {"symbol": "SI=F",   "name": "銀期貨"},
    {"symbol": "HG=F",   "name": "銅期貨"},
    {"symbol": "CL=F",   "name": "紐約輕原油"},
    {"symbol": "^GSPC",  "name": "標普500指數"},
    {"symbol": "^NDX",   "name": "納斯達克100"},
    {"symbol": "2330.TW","name": "台積電"},
    {"symbol": "0050.TW","name": "元大台灣50"},
]
```

若要新增商品，在此列表加入新項目，並同步在 `STOCK_NAMES` 字典補上中文名。

---

## 七、效能優化歷史記錄

| 優化項目 | 優化前 | 優化後 |
|---------|--------|--------|
| 監控面板載入 | ~28 秒（16 次序列 DB 查詢）| < 700ms（2 次批次查詢）|
| 單檔重複分析（快取命中）| ~2-5 秒 | < 10ms |
| yfinance 同步頻率 | 每 2 分鐘 | 每 30 分鐘 |
| VIX 快取 | 10 分鐘，以精確日期為 key | 30 分鐘，以 period_years 為 key |
| DB 連線開銷 | 每次 TCP 握手 | 連線池持久保持 |

---

## 八、已知問題與待辦（接手 Agent 請處理）

### 🔴 最優先：修正 `sync_db.py`

`sync_db.py` 的 `ticker.history()` 呼叫**尚未加上 `auto_adjust=False`**，若用此腳本批次同步，寫入 DB 的資料會是「還原後股價」，導致月均線計算錯誤。

**修正方法**：在 `sync_db.py` 中，所有 `ticker.history(...)` 呼叫都加上 `auto_adjust=False` 參數。

### 🟡 建議：預熱常用股票資料

清空 DB 後，只有使用者搜尋過的股票才會重新存入。建議修正 `sync_db.py` 後，執行批次同步：
```bash
python sync_db.py
```

### 🟡 建議：GitHub Actions 每日排程

設定 `.github/workflows/db_sync.yml`，每日台股收盤後（UTC 14:00 = 台灣 22:00）自動執行 `sync_db.py`。

### 🟢 選做：Supabase 防休眠探活

Supabase 免費版若連續 7 天沒有請求會自動暫停。可在 GitHub Actions 加入每 3 天的 `SELECT 1` 探活 job。

---

## 九、相依套件

```
fastapi
uvicorn
numpy
pandas
yfinance
sqlalchemy
psycopg2-binary
python-dotenv
```
