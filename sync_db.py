import yfinance as yf
import datetime
import sys
from database import SessionLocal, DB_ENABLED, init_db
from main import standardize_symbol, rebuild_stock_data_in_db, upsert_daily_prices, upsert_weekly_prices, get_market_today

# Default watchlist symbols to keep updated
TRACKED_SYMBOLS = [
    "2330.TW", "0050.TW", "0056.TW", "00878.TW", "00919.TW", "00929.TW", 
    "2317.TW", "2454.TW", "SPY", "VOO", "QQQ", "AAPL", "MSFT", "GOOGL", 
    "NVDA", "TSLA", "META", "GC=F", "SI=F", "HG=F", "CL=F", "^GSPC", "^NDX"
]

def sync_stock(symbol: str):
    if not DB_ENABLED:
        print("[Sync] Database is not enabled. Please check DATABASE_URL environment variable.")
        return
        
    db = SessionLocal()
    try:
        search_symbol = standardize_symbol(symbol)
        ticker = yf.Ticker(search_symbol)
        print(f"\n[Sync] Starting synchronization for {search_symbol}...")
        
        # Check database for existing data
        from database import DailyPrice
        latest_record = db.query(DailyPrice).filter_by(symbol=search_symbol).order_by(DailyPrice.date.desc()).first()
        
        if not latest_record:
            # Cache miss: perform full rebuild
            rebuild_stock_data_in_db(db, search_symbol, ticker)
            print(f"[Sync] Completed full historical sync for {search_symbol}.")
        else:
            latest_db_date = latest_record.date
            today = get_market_today(search_symbol)
            
            if latest_db_date < today:
                # Fetch incremental updates (last 30 days) to check for splits/dividends adjustments
                # auto_adjust=False：使用原始未還原股價，與月均線計算一致
                fetch_start = latest_db_date - datetime.timedelta(days=30)
                df_new = ticker.history(start=fetch_start.strftime('%Y-%m-%d'), end=today.strftime('%Y-%m-%d'), auto_adjust=False)
                
                if not df_new.empty:
                    df_new = df_new.dropna(subset=['Close'])
                    df_new = df_new[~df_new.index.duplicated(keep='first')]
                    
                    # Check for splits
                    if (df_new['Stock Splits'] > 0).any():
                        rebuild_stock_data_in_db(db, search_symbol, ticker)
                        print(f"[Sync] Detected stock split. Rebuilt historical data for {search_symbol}.")
                    else:
                        # Upsert new daily prices
                        upsert_daily_prices(db, search_symbol, df_new)
                        
                        # Resample and upsert weekly prices
                        df_weekly_new = df_new.resample('W').agg({
                            'Open': 'first',
                            'High': 'max',
                            'Low': 'min',
                            'Close': 'last',
                            'Volume': 'sum'
                        }).dropna()
                        upsert_weekly_prices(db, search_symbol, df_weekly_new)
                        print(f"[Sync] Completed incremental sync for {search_symbol}.")
                else:
                    print(f"[Sync] No new data found for {search_symbol}.")
            else:
                print(f"[Sync] {search_symbol} is already up-to-date (Latest date in DB: {latest_db_date}).")
    except Exception as e:
        print(f"[Sync] Error syncing {symbol}: {e}")
    finally:
        db.close()

def main():
    init_db()
    symbols = sys.argv[1:] if len(sys.argv) > 1 else TRACKED_SYMBOLS
    print(f"[Sync] Initializing synchronization for {len(symbols)} symbols...")
    for symbol in symbols:
        sync_stock(symbol)
    print("\n[Sync] All synchronizations completed.")

if __name__ == "__main__":
    main()
