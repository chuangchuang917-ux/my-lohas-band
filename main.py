import datetime
import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
from database import init_db, DB_ENABLED, DailyPrice, WeeklyPrice, SessionLocal

app = FastAPI(title="LOHAS Linear Regression Band Analyzer")

# Ensure static directory exists
if not os.path.exists("static"):
    os.makedirs("static")

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.on_event("startup")
def on_startup():
    init_db()

@app.get("/")
def read_root():
    return FileResponse("static/index.html")

def get_lohas_level(bias_val: float) -> str:
    """根據標準差偏離倍數 (Z-Score) 決定當前的樂活五線譜股價位階"""
    if bias_val >= 2.0:
        return "極樂觀 (高檔風險，≥ +2σ)"
    elif 1.0 <= bias_val < 2.0:
        return "樂觀 (+1σ ~ +2σ)"
    elif 0.0 <= bias_val < 1.0:
        return "偏樂觀 (0 ~ +1σ)"
    elif -1.0 <= bias_val < 0.0:
        return "偏悲觀 (-1σ ~ 0)"
    elif -2.0 <= bias_val < -1.0:
        return "悲觀 (-2σ ~ -1σ)"
    else:
        return "極悲觀 (低估機會，< -2σ)"

# 常用股票代碼中英文名稱對照表 (確保熱門股載入速度與顯示品質)
STOCK_NAMES = {
    # 台股熱門 / Presets
    "2330.TW": "台積電",
    "0050.TW": "元大台灣50",
    "0056.TW": "元大高股息",
    "00878.TW": "國泰永續高股息",
    "00919.TW": "群益台灣精選高息",
    "00929.TW": "復華台灣科技優息",
    "2317.TW": "鴻海",
    "2454.TW": "聯發科",
    "2308.TW": "台達電",
    "2881.TW": "富邦金",
    "2882.TW": "國泰金",
    "2891.TW": "中信金",
    "2886.TW": "兆豐金",
    "2002.TW": "中鋼",
    "2603.TW": "長榮",
    "2609.TW": "陽明",
    "2615.TW": "萬海",
    "2382.TW": "廣達",
    "2324.TW": "仁寶",
    "3231.TW": "緯創",
    "2357.TW": "華碩",
    "2303.TW": "聯電",
    
    # 美股熱門 / Presets
    "SPY": "S&P 500 ETF",
    "VOO": "Vanguard S&P 500 ETF",
    "QQQ": "Invesco QQQ Trust",
    "AAPL": "蘋果公司",
    "MSFT": "微軟公司",
    "GOOGL": "谷歌",
    "GOOG": "谷歌",
    "AMZN": "亞馬遜",
    "NVDA": "輝達公司",
    "TSLA": "特斯拉",
    "META": "Meta Platforms",
    "NFLX": "奈飛",
    "BRK.B": "波克夏 B 股",
    "BRK-B": "波克夏 B 股",
    "BRK.A": "波克夏 A 股",
    "BRK-A": "波克夏 A 股",
    "AMD": "超微半導體",
    "INTC": "英特爾",
    
    # 監控商品與期貨指數
    "GC=F": "黃金期貨",
    "SI=F": "白銀期貨",
    "HG=F": "銅期貨",
    "CL=F": "紐約輕原油期貨",
    "^GSPC": "標普500指數",
    "^NDX": "納斯達克100指數",
    "^VIX": "恐慌指數",
    # 新增監控商品
    "^TWII": "台灣加權指數",
    "^VNINDEX": "越南胡志明指數",
    "^N225": "日本日經225",
    "ZS=F": "大豆期貨",
    "ZC=F": "玉米期貨",
    "ZW=F": "小麥期貨",
    "BTC-USD": "比特幣",
    "ETH-USD": "以太幣",
}

COMPANY_NAME_CACHE = {}

def get_company_name(symbol: str, ticker) -> str:
    sym_upper = symbol.upper().strip()
    if sym_upper in STOCK_NAMES:
        return STOCK_NAMES[sym_upper]
    if sym_upper in COMPANY_NAME_CACHE:
        return COMPANY_NAME_CACHE[sym_upper]
    try:
        # 嘗試取得 info 名稱，若 yfinance 沒有回應或超時則直接返回代碼
        info = ticker.info
        name = info.get('longName') or info.get('shortName') or symbol
        COMPANY_NAME_CACHE[sym_upper] = name
        return name
    except Exception:
        return symbol

def standardize_symbol(symbol: str) -> str:
    sym = symbol.strip().upper()
    if sym.isdigit():
        sym = f"{sym}.TW"
    return sym

def is_market_closed(symbol: str) -> bool:
    # Get current UTC time
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    sym = symbol.upper().strip()
    
    if sym.endswith(".TW") or sym.endswith(".TWO") or sym.isdigit():
        # Taiwan market: UTC+8
        cst_time = now_utc + datetime.timedelta(hours=8)
        # Market closes at 13:30. Let's say it is finalized by 14:00
        if cst_time.weekday() >= 5:
            return True
        minutes_of_day = cst_time.hour * 60 + cst_time.minute
        if minutes_of_day >= 840:
            return True
        return False
    else:
        # Assume US market: UTC-5 (EST)
        # Market closes at 16:00 EST. Let's say it is finalized by 17:00 EST.
        # 17:00 EST is 22:00 UTC. So we check EST (UTC-5)
        est_time = now_utc - datetime.timedelta(hours=5)
        if est_time.weekday() >= 5:
            return True
        minutes_of_day = est_time.hour * 60 + est_time.minute
        if minutes_of_day >= 1020:
            return True
        return False

def get_market_today(symbol: str) -> datetime.date:
    """取得目標股票市場目前的本地日期（時區相容）"""
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    sym = symbol.upper().strip()
    if sym.endswith(".TW") or sym.endswith(".TWO") or sym.isdigit():
        # Taiwan market: UTC+8
        return (now_utc + datetime.timedelta(hours=8)).date()
    else:
        # Assume US market: UTC-5 (EST)
        return (now_utc - datetime.timedelta(hours=5)).date()

def upsert_daily_prices(db, symbol: str, df: pd.DataFrame):
    """
    Upsert daily prices into the database in a database-agnostic way.
    Only writes finalized historical dates (before today).
    Today's date is written only if market is closed.
    """
    today = get_market_today(symbol)
    market_closed = is_market_closed(symbol)
    
    # Query only the dates present in the incoming dataframe to avoid duplicate checks
    df_dates = [dt.date() if hasattr(dt, 'date') else dt for dt in df.index]
    existing_records = {r.date: r for r in db.query(DailyPrice).filter(DailyPrice.symbol == symbol, DailyPrice.date.in_(df_dates)).all()}
    
    new_records = []
    updated_count = 0
    
    for dt, row in df.iterrows():
        record_date = dt.date() if hasattr(dt, 'date') else dt
        
        # Check if today is finalized
        if record_date == today and not market_closed:
            continue
            
        close_val = float(row['Close'])
        if pd.isna(close_val):
            continue
            
        if record_date in existing_records:
            rec = existing_records[record_date]
            if abs(rec.close_price - close_val) > 1e-5:
                rec.close_price = close_val
                updated_count += 1
        else:
            new_records.append({
                "symbol": symbol,
                "date": record_date,
                "close_price": close_val
            })
            
    if new_records:
        db.execute(DailyPrice.__table__.insert(), new_records)
    db.commit()
    print(f"[Database] {symbol} Daily Price Sync: Added {len(new_records)} new rows, updated {updated_count} rows.")

def upsert_weekly_prices(db, symbol: str, df_weekly: pd.DataFrame):
    # Query only the dates present in the incoming dataframe to avoid duplicate checks
    df_dates = [dt.date() if hasattr(dt, 'date') else dt for dt in df_weekly.index]
    existing_records = {r.date: r for r in db.query(WeeklyPrice).filter(WeeklyPrice.symbol == symbol, WeeklyPrice.date.in_(df_dates)).all()}
    
    new_records = []
    updated_count = 0
    
    for dt, row in df_weekly.iterrows():
        record_date = dt.date() if hasattr(dt, 'date') else dt
        
        open_val = float(row['Open'])
        high_val = float(row['High'])
        low_val = float(row['Low'])
        close_val = float(row['Close'])
        vol_val = int(row['Volume'])
        
        if pd.isna(open_val) or pd.isna(high_val) or pd.isna(low_val) or pd.isna(close_val):
            continue
            
        if record_date in existing_records:
            rec = existing_records[record_date]
            if (abs(rec.open_price - open_val) > 1e-5 or 
                abs(rec.high_price - high_val) > 1e-5 or 
                abs(rec.low_price - low_val) > 1e-5 or 
                abs(rec.close_price - close_val) > 1e-5 or 
                rec.volume != vol_val):
                
                rec.open_price = open_val
                rec.high_price = high_val
                rec.low_price = low_val
                rec.close_price = close_val
                rec.volume = vol_val
                updated_count += 1
        else:
            new_records.append({
                "symbol": symbol,
                "date": record_date,
                "open_price": open_val,
                "high_price": high_val,
                "low_price": low_val,
                "close_price": close_val,
                "volume": vol_val
            })
            
    if new_records:
        db.execute(WeeklyPrice.__table__.insert(), new_records)
    db.commit()
    print(f"[Database] {symbol} Weekly Price Sync: Added {len(new_records)} new rows, updated {updated_count} rows.")

def rebuild_stock_data_in_db(db, symbol: str, ticker) -> pd.DataFrame:
    """
    Deletes all historical records for the symbol, downloads 13.5 years of history from yfinance,
    saves finalized records to DB, and returns the daily DataFrame.
    """
    print(f"[Database] Rebuilding stock data for {symbol}...")
    
    # 1. Clear database records
    db.query(DailyPrice).filter_by(symbol=symbol).delete()
    db.query(WeeklyPrice).filter_by(symbol=symbol).delete()
    db.commit()
    
    # 2. Fetch full history (13.5 years + 30 days)
    # auto_adjust=False：使用原始未還原股價，與台股看盤軟體的月均線定義一致
    end_date = datetime.date.today()
    fetch_start = end_date - datetime.timedelta(days=int(13.5 * 365.25) + 30)
    
    df = ticker.history(start=fetch_start.strftime('%Y-%m-%d'), end=end_date.strftime('%Y-%m-%d'), auto_adjust=False)
    
    if df.empty:
        return df
        
    df = df.dropna(subset=['Close'])
    df = df[~df.index.duplicated(keep='first')]
    df = df.sort_index()
    
    # 3. Save to database
    upsert_daily_prices(db, symbol, df)
    
    # Resample and save weekly
    df_weekly = df.resample('W').agg({
        'Open': 'first',
        'High': 'max',
        'Low': 'min',
        'Close': 'last',
        'Volume': 'sum'
    }).dropna()
    upsert_weekly_prices(db, symbol, df_weekly)
    
    return df

VIX_CACHE = {}  # key: period_years -> (timestamp, vix_dates, vix_actual)

def get_cached_vix(start_date, end_date, period_years: float = 0):
    import time
    now = time.time()
    # 使用 period_years 做快取 key，相同分析區間共享 VIX 快取，大幅提升命中率
    key = round(period_years, 1) if period_years else (start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d'))
    if key in VIX_CACHE:
        timestamp, vix_dates, vix_actual = VIX_CACHE[key]
        if now - timestamp < 1800:  # Cache for 30 minutes
            return vix_dates, vix_actual
    try:
        vix_ticker = yf.Ticker("^VIX")
        vix_df = vix_ticker.history(start=start_date.strftime('%Y-%m-%d'), end=end_date.strftime('%Y-%m-%d'))
        if not vix_df.empty:
            vix_df = vix_df.dropna(subset=['Close'])
            vix_dates = vix_df.index.strftime('%Y-%m-%d').tolist()
            vix_actual = vix_df['Close'].tolist()
            VIX_CACHE[key] = (now, vix_dates, vix_actual)
            return vix_dates, vix_actual
    except Exception as e:
        print(f"Error fetching VIX data: {e}")
    return [], []

LOHAS_DATA_CACHE = {}  # key: (search_symbol, period_years) -> (timestamp, result_dict)
SYMBOL_LAST_UPDATE_CHECK = {}  # key: search_symbol -> timestamp of last yfinance update check

@app.get("/api/lohas")
def get_lohas_data(symbol: str, period_years: float, use_cache_only: bool = False, db = None):
    """
    獲取股票歷史資料並計算樂活五線譜與5年/10年均線數值 (具備 5 分鐘極速記憶體快取)
    - symbol: 股票代碼 (例如 2330.TW 或 SPY)
    - period_years: 歷史分析年限 (例如 0.5, 1.5, 3.5)
    """
    import time
    now = time.time()
    search_symbol = standardize_symbol(symbol)
    # 快取 key 不包含 use_cache_only，讓 monitor 的預熱結果可被單檔分析直接使用
    key = (search_symbol, period_years)
    
    if key in LOHAS_DATA_CACHE:
        timestamp, cached_data = LOHAS_DATA_CACHE[key]
        if now - timestamp < 300:  # 5 分鐘快取（原為 60 秒）
            return cached_data
            
    # 進行實際計算
    data = _get_lohas_data_impl(symbol, period_years, use_cache_only, db)
    
    # 寫入快取
    LOHAS_DATA_CACHE[key] = (now, data)
    return data

def _get_lohas_data_impl(symbol: str, period_years: float, use_cache_only: bool = False, db = None):
    if period_years <= 0:
        raise HTTPException(status_code=400, detail="時間區間長度必須大於 0")

    try:
        # 1. 輔助：防呆自動修正台灣股票代號並取得 Ticker 實例
        search_symbol = standardize_symbol(symbol)
        ticker = yf.Ticker(search_symbol)
        
        # 2. 回推歷史顯示區間起點與計算區間
        end_date = get_market_today(search_symbol)
        start_date = end_date - datetime.timedelta(days=int(period_years * 365))
        
        # 初始化資料容器
        daily_dates = []
        daily_closes = []
        weekly_dates = []
        weekly_opens = []
        weekly_highs = []
        weekly_lows = []
        weekly_closes = []
        weekly_volumes = []
        
        db_created = False
        if DB_ENABLED:
            try:
                if db is None:
                    db = SessionLocal()
                    db_created = True
                # 檢查 DB 中是否有該股票的歷史資料
                latest_record = db.query(DailyPrice).filter_by(symbol=search_symbol).order_by(DailyPrice.date.desc()).first()
                
                if not latest_record:
                    # 快取失效：DB 中沒有此股，進行首次 13.5 年的完整下載並寫入
                    df_full = rebuild_stock_data_in_db(db, search_symbol, ticker)
                    if df_full.empty:
                        raise HTTPException(status_code=404, detail=f"找不到股票代碼 '{search_symbol}' 的歷史資料。請確認代碼是否正確。")
                else:
                    latest_db_date = latest_record.date
                    import time
                    now_ts = time.time()
                    already_checked = (search_symbol in SYMBOL_LAST_UPDATE_CHECK and (now_ts - SYMBOL_LAST_UPDATE_CHECK[search_symbol] < 1800))  # 30 分鐘內不重複查 yfinance（原為 2 分鐘）
                    
                    # 如果資料庫最新日期早於今天，且最近 2 分鐘內沒有檢查過，則檢查是否有增量更新
                    if not use_cache_only and not already_checked and latest_db_date < end_date:
                        # 增量更新：抓取資料庫最後 30 天到今天的資料，用於檢查分割與做增量 upsert
                        # auto_adjust=False：使用原始未還原股價
                        fetch_start = latest_db_date - datetime.timedelta(days=30)
                        df_new = ticker.history(start=fetch_start.strftime('%Y-%m-%d'), end=end_date.strftime('%Y-%m-%d'), auto_adjust=False)
                        
                        if not df_new.empty:
                            df_new = df_new.dropna(subset=['Close'])
                            df_new = df_new[~df_new.index.duplicated(keep='first')]
                            
                            # 檢查是否有發生股票分割事件 (Stock Splits > 0)
                            if (df_new['Stock Splits'] > 0).any():
                                # 偵測到分割，必須清空資料庫並完整重建該股票的所有還原歷史資料
                                rebuild_stock_data_in_db(db, search_symbol, ticker)
                            else:
                                # 沒有分割，安全執行日收盤價增量寫入
                                upsert_daily_prices(db, search_symbol, df_new)
                                
                                # 週 K 線亦進行增量寫入
                                df_weekly_new = df_new.resample('W').agg({
                                    'Open': 'first',
                                    'High': 'max',
                                    'Low': 'min',
                                    'Close': 'last',
                                    'Volume': 'sum'
                                }).dropna()
                                upsert_weekly_prices(db, search_symbol, df_weekly_new)
                                
                        # 記錄最後檢查時間
                        SYMBOL_LAST_UPDATE_CHECK[search_symbol] = now_ts
                
                # 從資料庫加載完整歷史資料 (使用 with_entities 加速讀取)
                db_daily = db.query(DailyPrice.date, DailyPrice.close_price)\
                             .filter_by(symbol=search_symbol)\
                             .order_by(DailyPrice.date.asc()).all()
                daily_dates = [r.date for r in db_daily]
                daily_closes = [r.close_price for r in db_daily]
                
                db_weekly = db.query(WeeklyPrice.date, WeeklyPrice.open_price, WeeklyPrice.high_price, WeeklyPrice.low_price, WeeklyPrice.close_price, WeeklyPrice.volume)\
                              .filter_by(symbol=search_symbol)\
                              .order_by(WeeklyPrice.date.asc()).all()
                weekly_dates = [r.date for r in db_weekly]
                weekly_opens = [r.open_price for r in db_weekly]
                weekly_highs = [r.high_price for r in db_weekly]
                weekly_lows = [r.low_price for r in db_weekly]
                weekly_closes = [r.close_price for r in db_weekly]
                weekly_volumes = [r.volume for r in db_weekly]
                
            except Exception as e:
                print(f"[Database Error] DB 存取異常 ({e})，自動 Fallback 到 yfinance 即時讀取模式...")
                daily_closes = []  # 確保清空以觸發 Fallback
            finally:
                if db_created and db:
                    db.close()
                    
        # 3. Fallback：如果沒有啟用資料庫，或者資料庫讀取失敗，直接使用原本的 yfinance 讀取方式
        if not daily_closes:
            fetch_years = period_years + 10
            start_date_fetch = end_date - datetime.timedelta(days=int(fetch_years * 365.25) + 30)
            # auto_adjust=False：使用原始未還原股價，與市場軟體定義一致
            df_fallback = ticker.history(start=start_date_fetch.strftime('%Y-%m-%d'), end=end_date.strftime('%Y-%m-%d'), auto_adjust=False)
            
            if df_fallback.empty:
                raise HTTPException(status_code=404, detail=f"找不到股票代碼 '{search_symbol}' 在該期間的資料。請確認代碼是否正確。")
                
            df_fallback = df_fallback.dropna(subset=['Close'])
            df_fallback = df_fallback[~df_fallback.index.duplicated(keep='first')]
            df_fallback = df_fallback.sort_index()
            
            daily_dates = df_fallback.index.date.tolist()
            daily_closes = df_fallback['Close'].tolist()
            
            df_weekly_fallback = df_fallback.resample('W').agg({
                'Open': 'first',
                'High': 'max',
                'Low': 'min',
                'Close': 'last',
                'Volume': 'sum'
            }).dropna()
            
            weekly_dates = df_weekly_fallback.index.date.tolist()
            weekly_opens = df_weekly_fallback['Open'].tolist()
            weekly_highs = df_weekly_fallback['High'].tolist()
            weekly_lows = df_weekly_fallback['Low'].tolist()
            weekly_closes = df_weekly_fallback['Close'].tolist()
            weekly_volumes = df_weekly_fallback['Volume'].tolist()
            
        else:
            # 4. 盤中即時資料拼裝 (Hybrid Real-time Model)：若資料庫最新日期早於今天，且目前盤中未收盤
            latest_db_date = daily_dates[-1]
            import time
            now_ts = time.time()
            already_checked_hybrid = (search_symbol in SYMBOL_LAST_UPDATE_CHECK and (now_ts - SYMBOL_LAST_UPDATE_CHECK[search_symbol] < 1800))  # 30 分鐘內不重複查即時報價
            if not use_cache_only and not already_checked_hybrid and latest_db_date < end_date and not is_market_closed(search_symbol):
                print(f"[Hybrid] 盤中未收盤，非同步抓取 {search_symbol} 今日即時報價並於記憶體中組裝...")
                df_today = ticker.history(period="1d", auto_adjust=False)
                if not df_today.empty:
                    today_date = df_today.index[0].date()
                    if today_date > latest_db_date:
                        today_open = float(df_today['Open'].iloc[0])
                        today_high = float(df_today['High'].iloc[0])
                        today_low = float(df_today['Low'].iloc[0])
                        today_close = float(df_today['Close'].iloc[0])
                        today_volume = int(df_today['Volume'].iloc[0])
                        
                        # 記憶體拼裝日線
                        daily_dates.append(today_date)
                        daily_closes.append(today_close)
                        
                        # 記憶體拼裝週線
                        days_to_sunday = 6 - today_date.weekday()
                        sunday_date = today_date + datetime.timedelta(days=days_to_sunday)
                        
                        if weekly_dates and weekly_dates[-1] == sunday_date:
                            # 累加並更新當前未收尾週
                            weekly_closes[-1] = today_close
                            weekly_highs[-1] = max(weekly_highs[-1], today_high)
                            weekly_lows[-1] = min(weekly_lows[-1], today_low)
                            weekly_volumes[-1] += today_volume
                        else:
                            # 新增此週
                            weekly_dates.append(sunday_date)
                            weekly_opens.append(today_open)
                            weekly_highs.append(today_high)
                            weekly_lows.append(today_low)
                            weekly_closes.append(today_close)
                            weekly_volumes.append(today_volume)

        # 5. 轉換為 pandas 格式進行核心五線譜、均線與通道運算
        df = pd.DataFrame({
            'Close': daily_closes
        }, index=pd.to_datetime(daily_dates))
        
        df_weekly = pd.DataFrame({
            'Open': weekly_opens,
            'High': weekly_highs,
            'Low': weekly_lows,
            'Close': weekly_closes,
            'Volume': weekly_volumes
        }, index=pd.to_datetime(weekly_dates))

        # 計算 5 年均線（60月線）與 10 年均線（120月線）
        # 正確做法：先 resample 成月線（取每月最後一個收盤價），再做 60/120 月滾動平均，最後 reindex 回日線
        df_monthly = df['Close'].resample('ME').last().dropna()  # ME = Month End
        ma_5y_monthly  = df_monthly.rolling(window=60,  min_periods=1).mean()  # 60月均線
        ma_10y_monthly = df_monthly.rolling(window=120, min_periods=1).mean()  # 120月均線
        
        # 將月線均值 reindex 回完整日線索引（用 forward-fill 讓每日都有值）
        ma_5y_full  = ma_5y_monthly.reindex(df.index, method='ffill')
        ma_10y_full = ma_10y_monthly.reindex(df.index, method='ffill')
        
        # 篩選切片至顯示區間 (顯示區間只包含最後的 period_years 數據)
        df_display = df[df.index.date >= start_date]
        N = len(df_display)
        
        if N < 5:
            raise HTTPException(status_code=400, detail=f"歷史顯示區間交易日資料過少 (僅 {N} 筆)，無法進行線性迴歸分析")
            
        # 時間序列轉等距自變數 X = [0, 1, 2, ..., N-1]
        X = np.arange(N)
        Y = df_display['Close'].values
        
        # 線性迴歸 (Linear Regression)：計算最佳擬合直線 Y = aX + b
        slope, intercept = np.polyfit(X, Y, 1)
        TL = slope * X + intercept  # 趨勢線預估值 (Trend Line)
        
        # 殘差標準差 (Standard Deviation of Residuals)
        residuals = Y - TL
        sigma = np.std(residuals)
        if sigma == 0:
            sigma = 1e-5
            
        # 計算五線譜各線數值
        top = TL + 2 * sigma       # 極樂觀線
        upper = TL + 1 * sigma     # 樂觀線
        central = TL               # 趨勢線
        lower = TL - 1 * sigma     # 悲觀線
        bottom = TL - 2 * sigma    # 極悲觀線
        
        # 計算偏離標準差倍數 (Z-Score)
        bias = (Y - TL) / sigma
        
        # 格式化日期格式 (YYYY-MM-DD)
        dates = df_display.index.strftime('%Y-%m-%d').tolist()
        
        # 取得最新一天的狀態資訊
        latest_idx = N - 1
        latest_date = dates[latest_idx]
        latest_actual = float(Y[latest_idx])
        latest_central = float(TL[latest_idx])
        latest_bias = float(bias[latest_idx])
        latest_level = get_lohas_level(latest_bias)
        
        # 切片對應顯示區間的 60月均線 / 120月均線數據
        ma_5y  = ma_5y_full.reindex(df_display.index, method='ffill').tolist()
        ma_10y = ma_10y_full.reindex(df_display.index, method='ffill').tolist()
        
        # 計算樂活通道 (LOHAS Channel) - 週線數據
        N_w = len(df_weekly)
        if N_w >= 1:
            hl = df_weekly['High'] - df_weekly['Low']
            mid = (df_weekly['High'] + df_weekly['Low']) / 2.0
            k = np.where(mid == 0, 0, hl / mid)
            
            h_2k = df_weekly['High'] * (1 + 2 * k)
            l_2k = df_weekly['Low'] * (1 - 2 * k)
            
            ma = df_weekly['Close'].rolling(window=20, min_periods=1).mean()
            up_band = h_2k.rolling(window=20, min_periods=1).mean()
            down_band = l_2k.rolling(window=20, min_periods=1).mean()
            
            # 週線切片至顯示區間
            df_weekly_display = df_weekly[df_weekly.index.date >= start_date]
            
            channel_dates = df_weekly_display.index.strftime('%Y-%m-%d').tolist()
            channel_actual = df_weekly_display['Close'].tolist()
            channel_ma = ma.loc[df_weekly_display.index].tolist()
            channel_up = up_band.loc[df_weekly_display.index].tolist()
            channel_down = down_band.loc[df_weekly_display.index].tolist()
        else:
            channel_dates = []
            channel_actual = []
            channel_ma = []
            channel_up = []
            channel_down = []

        # 8. 獲取恐慌指數 (VIX)
        vix_dates, vix_actual = get_cached_vix(start_date, end_date, period_years)

        # 獲取公司名稱
        company_name = get_company_name(search_symbol, ticker)
        
        return {
            "symbol": search_symbol,
            "company_name": company_name,
            "period_years": period_years,
            "dates": dates,
            "actual": Y.tolist(),
            "ma_5y": ma_5y,
            "ma_10y": ma_10y,
            "top": top.tolist(),
            "upper": upper.tolist(),
            "central": central.tolist(),
            "lower": lower.tolist(),
            "bottom": bottom.tolist(),
            "bias": bias.tolist(),
            "latest": {
                "date": latest_date,
                "actual": latest_actual,
                "central": latest_central,
                "bias": latest_bias,
                "sigma": float(sigma),
                "level": latest_level
            },
            "channel": {
                "dates": channel_dates,
                "actual": channel_actual,
                "ma": channel_ma,
                "up_band": channel_up,
                "down_band": channel_down
            },
            "vix": {
                "dates": vix_dates,
                "actual": vix_actual
            }
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"後端計算時發生錯誤: {str(e)}")

# List of symbols to show in the real-time product monitoring dashboard
MONITOR_ITEMS = [
    # 原有商品
    {"symbol": "GC=F",    "name": "黃金期貨"},
    {"symbol": "SI=F",    "name": "銀期貨"},
    {"symbol": "HG=F",    "name": "銅期貨"},
    {"symbol": "CL=F",    "name": "紐約輕原油"},
    {"symbol": "^GSPC",   "name": "標普500指數"},
    {"symbol": "^NDX",    "name": "納斯達克100"},
    {"symbol": "2330.TW", "name": "台積電"},
    {"symbol": "0050.TW", "name": "元大台灣50"},
    # 新增商品
    {"symbol": "^TWII",   "name": "台灣加權指數"},
    {"symbol": "FVNM",    "name": "越南ETF(FVNM)"},
    {"symbol": "^N225",   "name": "日本日經225"},
    {"symbol": "ZS=F",    "name": "大豆期貨"},
    {"symbol": "ZC=F",    "name": "玉米期貨"},
    {"symbol": "ZW=F",    "name": "小麥期貨"},
    {"symbol": "BTC-USD", "name": "比特幣"},
    {"symbol": "ETH-USD", "name": "以太幣"},
]

@app.get("/api/monitor")
def get_monitor_data(symbols: str = None):
    """
    返回監控面板資料。
    - symbols: 可選，逗號分隔的股票代碼，例如 "GC=F,BTC-USD,2330.TW"
      若未提供則使用預設的 MONITOR_ITEMS 清單。
    """
    # 決定本次要查詢的商品清單
    if symbols:
        custom_syms = [s.strip() for s in symbols.split(',') if s.strip()]
        items = [{"symbol": standardize_symbol(s), "name": STOCK_NAMES.get(s.strip().upper(), s.strip().upper())} for s in custom_syms]
    else:
        items = MONITOR_ITEMS
    result = []

    if not DB_ENABLED:
        # Fallback to sequential yfinance/direct model
        for item in items:
            try:
                data = get_lohas_data(item["symbol"], 3.5, use_cache_only=True)
                actual_prices = data["actual"]
                if not actual_prices:
                    raise ValueError("No price data")
                price = actual_prices[-1]
                prev_price = actual_prices[-2] if len(actual_prices) > 1 else price
                change = price - prev_price
                change_percent = (change / prev_price) * 100 if prev_price != 0 else 0
                
                bias = data["latest"]["bias"]
                if bias < -2.0: lohas_level = 1
                elif bias < -1.0: lohas_level = 2
                elif bias < 0.0: lohas_level = 3
                elif bias < 1.0: lohas_level = 4
                elif bias < 2.0: lohas_level = 5
                else: lohas_level = 6
                
                channel_actual = data["channel"]["actual"]
                if channel_actual:
                    w_close = channel_actual[-1]
                    w_ma = data["channel"]["ma"][-1]
                    w_up = data["channel"]["up_band"][-1]
                    w_down = data["channel"]["down_band"][-1]
                    if w_close > w_up: channel_level = 4
                    elif w_close < w_down: channel_level = 1
                    elif w_close >= w_ma: channel_level = 3
                    else: channel_level = 2
                else:
                    channel_level = 2
                    
                result.append({
                    "symbol": data["symbol"],
                    "name": item["name"],
                    "price": price,
                    "change": change,
                    "change_percent": change_percent,
                    "lohas_level": lohas_level,
                    "channel_level": channel_level
                })
            except Exception:
                result.append({
                    "symbol": item["symbol"],
                    "name": item["name"],
                    "price": 0.0,
                    "change": 0.0,
                    "change_percent": 0.0,
                    "lohas_level": 3,
                    "channel_level": 2
                })
        return result

    # DB is enabled: run optimized batch queries
    db = SessionLocal()
    try:
        from collections import defaultdict
        
        period_years = 3.5
        end_date = datetime.date.today()
        start_date = end_date - datetime.timedelta(days=int(period_years * 365))
        weekly_start_date = start_date - datetime.timedelta(weeks=26)
        
        symbols_map = {standardize_symbol(item["symbol"]): item for item in items}
        symbols_list = list(symbols_map.keys())
        
        # Batch query daily and weekly data (only fetching needed columns)
        daily_data = db.query(DailyPrice.symbol, DailyPrice.date, DailyPrice.close_price)\
                       .filter(DailyPrice.symbol.in_(symbols_list), DailyPrice.date >= start_date)\
                       .order_by(DailyPrice.date.asc()).all()
                       
        weekly_data = db.query(WeeklyPrice.symbol, WeeklyPrice.date, WeeklyPrice.open_price, WeeklyPrice.high_price, WeeklyPrice.low_price, WeeklyPrice.close_price, WeeklyPrice.volume)\
                        .filter(WeeklyPrice.symbol.in_(symbols_list), WeeklyPrice.date >= weekly_start_date)\
                        .order_by(WeeklyPrice.date.asc()).all()
                        
        daily_by_symbol = defaultdict(list)
        for row in daily_data:
            daily_by_symbol[row.symbol].append(row)
            
        weekly_by_symbol = defaultdict(list)
        for row in weekly_data:
            weekly_by_symbol[row.symbol].append(row)
            
        for s_symbol in symbols_list:
            item = symbols_map[s_symbol]
            try:
                d_rows = daily_by_symbol[s_symbol]
                w_rows = weekly_by_symbol[s_symbol]
                
                # If DB does not contain this symbol yet, trigger get_lohas_data to fetch it
                if not d_rows:
                    data = get_lohas_data(s_symbol, 3.5, use_cache_only=True, db=db)
                    actual_prices = data["actual"]
                    if not actual_prices:
                        raise ValueError("No price data")
                    price = actual_prices[-1]
                    prev_price = actual_prices[-2] if len(actual_prices) > 1 else price
                    change = price - prev_price
                    change_percent = (change / prev_price) * 100 if prev_price != 0 else 0
                    
                    bias = data["latest"]["bias"]
                    if bias < -2.0: lohas_level = 1
                    elif bias < -1.0: lohas_level = 2
                    elif bias < 0.0: lohas_level = 3
                    elif bias < 1.0: lohas_level = 4
                    elif bias < 2.0: lohas_level = 5
                    else: lohas_level = 6
                    
                    channel_actual = data["channel"]["actual"]
                    if channel_actual:
                        w_close = channel_actual[-1]
                        w_ma = data["channel"]["ma"][-1]
                        w_up = data["channel"]["up_band"][-1]
                        w_down = data["channel"]["down_band"][-1]
                        if w_close > w_up: channel_level = 4
                        elif w_close < w_down: channel_level = 1
                        elif w_close >= w_ma: channel_level = 3
                        else: channel_level = 2
                    else:
                        channel_level = 2
                else:
                    # Perform LOHAS linear regression in memory
                    daily_dates = [r.date for r in d_rows]
                    daily_closes = [r.close_price for r in d_rows]
                    
                    df = pd.DataFrame({'Close': daily_closes}, index=pd.to_datetime(daily_dates))
                    N = len(df)
                    
                    if N < 5:
                        raise ValueError("Insufficient daily data for regression")
                        
                    X = np.arange(N)
                    Y = df['Close'].values
                    slope, intercept = np.polyfit(X, Y, 1)
                    TL = slope * X + intercept
                    residuals = Y - TL
                    sigma = np.std(residuals)
                    if sigma == 0:
                        sigma = 1e-5
                    bias = (Y - TL) / sigma
                    
                    price = float(Y[-1])
                    prev_price = float(Y[-2]) if N > 1 else price
                    change = price - prev_price
                    change_percent = (change / prev_price) * 100 if prev_price != 0 else 0
                    
                    latest_bias = float(bias[-1])
                    if latest_bias < -2.0: lohas_level = 1
                    elif latest_bias < -1.0: lohas_level = 2
                    elif latest_bias < 0.0: lohas_level = 3
                    elif latest_bias < 1.0: lohas_level = 4
                    elif latest_bias < 2.0: lohas_level = 5
                    else: lohas_level = 6
                    
                    # Calculate Weekly LOHAS Channel in memory
                    channel_level = 2
                    if w_rows:
                        w_dates = [r.date for r in w_rows]
                        w_opens = [r.open_price for r in w_rows]
                        w_highs = [r.high_price for r in w_rows]
                        w_lows = [r.low_price for r in w_rows]
                        w_closes = [r.close_price for r in w_rows]
                        w_volumes = [r.volume for r in w_rows]
                        
                        df_weekly = pd.DataFrame({
                            'Open': w_opens,
                            'High': w_highs,
                            'Low': w_lows,
                            'Close': w_closes,
                            'Volume': w_volumes
                        }, index=pd.to_datetime(w_dates))
                        
                        hl = df_weekly['High'] - df_weekly['Low']
                        mid = (df_weekly['High'] + df_weekly['Low']) / 2.0
                        k = np.where(mid == 0, 0, hl / mid)
                        h_2k = df_weekly['High'] * (1 + 2 * k)
                        l_2k = df_weekly['Low'] * (1 - 2 * k)
                        
                        ma = df_weekly['Close'].rolling(window=20, min_periods=1).mean()
                        up_band = h_2k.rolling(window=20, min_periods=1).mean()
                        down_band = l_2k.rolling(window=20, min_periods=1).mean()
                        
                        df_weekly_display = df_weekly[df_weekly.index.date >= start_date]
                        if not df_weekly_display.empty:
                            w_close = float(df_weekly_display['Close'].iloc[-1])
                            w_ma = float(ma.loc[df_weekly_display.index].iloc[-1])
                            w_up = float(up_band.loc[df_weekly_display.index].iloc[-1])
                            w_down = float(down_band.loc[df_weekly_display.index].iloc[-1])
                            
                            if w_close > w_up: channel_level = 4
                            elif w_close < w_down: channel_level = 1
                            elif w_close >= w_ma: channel_level = 3
                            else: channel_level = 2
                            
                result.append({
                    "symbol": s_symbol,
                    "name": item["name"],
                    "price": price,
                    "change": change,
                    "change_percent": change_percent,
                    "lohas_level": lohas_level,
                    "channel_level": channel_level
                })
            except Exception as e:
                print(f"Error calculating monitor item {s_symbol}: {e}")
                result.append({
                    "symbol": s_symbol,
                    "name": item["name"],
                    "price": 0.0,
                    "change": 0.0,
                    "change_percent": 0.0,
                    "lohas_level": 3,
                    "channel_level": 2
                })
    finally:
        db.close()
        
    return result

