# LOHAS 資料庫整合系統設計與架構規劃書 (Supabase/PostgreSQL)

本文件專為接手的 AI Coding Agent 或開發團隊設計，詳細闡述了將本股票分析系統（樂活五線譜、樂活通道、均線指標）對接 **Supabase / PostgreSQL** 資料庫的核心想法、具體實作做法、資料庫綱要 (Schema) 以及極端情況的解決方案。

---

## 1. 系統架構：讀穿快取 (Read-Through Cache)

為維持前端零改動與API向下相容，後端 `/api/lohas` 將採用「讀穿快取」機制。其業務邏輯流程如下：

```
                    [ 收到 /api/lohas 請求 ]
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
       [ 檢查本地 DB 是否有資料 ]      [ 資料庫中沒有該股票 ]
                │                             │
        ┌───────┴───────┐                     │
        ▼               ▼                     │
    [資料足夠]      [資料過舊/不足]            │
        │               │                     │
        │               └─────────────┬───────┘
        │                             ▼
        │                     [ 呼叫 yfinance API ]
        │                  (下載完整 13.5 年歷史數據)
        │                             │
        │                             ▼
        │                     [ 寫入本地 DB 存檔 ]
        │                       (批次 Upsert)
        │                             │
        └──────────────┬──────────────┘
                       ▼
            [ 執行五線譜/均線運算 ]
                       │
                       ▼
              [ 返回 JSON 給前端 ]
```

---

## 2. 資料庫綱要設計 (Schema Design)

為了在 Supabase `500 MB` 的免費容量內儲存最多股票（目標 1500+ 檔股票），我們必須對欄位進行**輕量化**設計，分開儲存日線（只需 Close）與週線（需開高低收量）。

### DailyPrice 表 (日 K 線收盤價表)
用於計算五線譜軌道與 5年/10年 每日移動平均線。
```sql
CREATE TABLE daily_prices (
    id BIGSERIAL PRIMARY KEY,
    symbol VARCHAR(15) NOT NULL,
    date DATE NOT NULL,
    close_price DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 建立複合唯一索引，防止重複寫入，並加快特定股票時間序列查詢
CREATE UNIQUE INDEX idx_symbol_date_daily ON daily_prices (symbol, date);
```

### WeeklyPrice 表 (週 K 線表)
僅用於計算樂活通道 (LOHAS Channel)。
```sql
CREATE TABLE weekly_prices (
    id BIGSERIAL PRIMARY KEY,
    symbol VARCHAR(15) NOT NULL,
    date DATE NOT NULL,
    open_price DOUBLE PRECISION NOT NULL,
    high_price DOUBLE PRECISION NOT NULL,
    low_price DOUBLE PRECISION NOT NULL,
    close_price DOUBLE PRECISION NOT NULL,
    volume BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 建立複合唯一索引
CREATE UNIQUE INDEX idx_symbol_date_weekly ON weekly_prices (symbol, date);
```

---

## 3. 核心挑戰與具體解決做法

### 挑戰 A：股票分割與除權息 (Stock Splits / Adjustments) ⚠️
Yahoo Finance 的價格會因為除權息或股票分割而**溯及既往地調整**歷史數值。若我們只以增量方式寫入，會造成資料庫內舊資料與新資料基準不一致，導致五線譜迴歸線直接崩壞。

*   **具體做法 (偵測與重建)**：
    1. 當每日同步腳本（或 API Fallback 抓取）讀取 yfinance 最新日 K 線時，檢查 DataFrame 中是否存在當日 `Stock Splits > 0` 或 `Dividends > 0` 的事件。
    2. 如果有發生分割，則對該 `symbol` 觸發 **「重建機制」**：
       - `DELETE FROM daily_prices WHERE symbol = :symbol;`
       - `DELETE FROM weekly_prices WHERE symbol = :symbol;`
       - 重新向 yfinance 下載 13.5 年完整最新還原股價，批次寫入資料庫。

---

### 挑戰 B：盤中即時資料整合 (Hybrid Real-time Model)
如果我們僅每天收盤後更新資料庫，使用者在盤中查詢時，會看不到今天的變動。
*   **具體做法 (混合讀取記憶體組裝)**：
    1. 當用戶發起請求時，API 優先從資料庫撈取歷史數據（約 3400 筆，耗時 < 15ms）。
    2. 檢查最新一筆資料庫日期。如果今天為交易日，且當下時間大於開盤時間、資料庫尚未存有今日收盤價：
       - 後端非同步呼叫 yfinance 抓取 **今日盤中最新 1 筆即時股價**（僅抓 today，速度非常快，約 100ms）。
       - 在記憶體中將「今日即時價格」Append 到從資料庫讀出的「歷史數值清單」末端。
    3. 將組裝好的完整序列送入五線譜與均線計算模組。
    4. **注意**：盤中數據為未收盤暫存，不寫入資料庫，等每日排程在收盤後再正式寫入。

---

### 挑戰 C：避免 Supabase 免費版被休眠 (Keep-Alive Cron)
Supabase 免費專案如果連續 7 天沒有 API 呼叫會自動暫停，喚醒需要時間。
*   **具體做法 (定時探活)**：
    在專案 `.github/workflows/db_sync.yml` 中新增一個排程：
    - 每隔 3 天定時觸發執行一個輕量 SQL 指令（如 `SELECT 1;`），保持 Supabase 專案永遠處於活動狀態。

---

### 挑戰 D：股票代碼防呆與標準化 (Standardization)
*   **具體做法**：
    在 API 與資料庫寫入層，設計一個標準化函數：
    ```python
    def standardize_symbol(symbol: str) -> str:
        sym = symbol.strip().upper()
        if sym.isdigit():
            # 台灣股票自動補上 .TW
            sym = f"{sym}.TW"
        return sym
    ```

---

## 4. 指令列同步與排程腳本設計 (`sync_db.py`)

為了讓資料庫保持最新狀態，接手的 Agent 應建立 `sync_db.py`。其主要結構框架如下：

```python
# sync_db.py 核心架構範例
import yfinance as yf
from database import SessionLocal
from database_models import DailyPrice, WeeklyPrice
import datetime

# 預期追蹤的熱門股票池
TRACKED_SYMBOLS = ["2330.TW", "0050.TW", "SPY", "AAPL", "VOO", "QQQ", "MSFT", "NVDA"]

def sync_stock(symbol):
    db = SessionLocal()
    # 1. 取得該股在資料庫的最新一筆日期
    latest_record = db.query(DailyPrice).filter_by(symbol=symbol).order_by(DailyPrice.date.desc()).first()
    
    if not latest_record:
        # 資料庫無資料 -> 抓取 13.5 年完整資料寫入 (大批次批次寫入)
        start_date = datetime.date.today() - datetime.timedelta(days=int(13.5 * 365.25))
    else:
        # 資料庫有資料 -> 增量抓取最新 5 天的資料進行比對
        start_date = latest_record.date - datetime.timedelta(days=5)

    ticker = yf.Ticker(symbol)
    df = ticker.history(start=start_date.strftime("%Y-%m-%d"))
    
    # 2. 比對若有股票分割 (df['Stock Splits'] > 0)，則清空並完整重新抓取
    if not df.empty and (df['Stock Splits'] > 0).any():
        db.query(DailyPrice).filter_by(symbol=symbol).delete()
        df = ticker.history(period="15y") # 重新抓取完整
        
    # 3. 執行 Upsert (存在則更新 Close，不存在則新增)
    # 4. 同步 Weekly 數據
    db.commit()
    db.close()

if __name__ == "__main__":
    for symbol in TRACKED_SYMBOLS:
        print(f"Syncing {symbol}...")
        sync_stock(symbol)
```

### GitHub Actions 定時排程配置範例
在專案根目錄下建立 `.github/workflows/db_sync.yml`：
```yaml
name: Daily Stock Data Sync
on:
  schedule:
    # 每天 UTC 時間 14:00 (台灣時間 22:00，此時美股開盤、台股已收盤)
    - cron: '0 14 * * *'
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: |
          pip install yfinance sqlalchemy psycopg2-binary python-dotenv pandas
      - name: Run Sync
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: python sync_db.py
```

---

## 5. 給接手 Agent 的實作清單 (Next Steps Checklists)

1.  [ ] 在專案中安裝 `sqlalchemy` 與 `psycopg2-binary` 並寫入 `requirements.txt`。
2.  [ ] 建立 `database.py` 定義與資料庫的連線與 `daily_prices` / `weekly_prices` Model。
3.  [ ] 在 `main.py` 的 FastAPI 啟動事件中，加入 `Base.metadata.create_all(bind=engine)` 自動建表。
4.  [ ] 在 `main.py` 的 `/api/lohas` 內實現前述的讀穿快取（Read-Through）與盤中即時資料拼裝（Hybrid）邏輯。
5.  [ ] 撰寫 `sync_db.py` 並在 GitHub 庫中設定 Secret `DATABASE_URL` 與 Actions 排程以自動化每日更新。
