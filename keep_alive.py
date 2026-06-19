import os
import psycopg2
import sys

def main():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("Error: DATABASE_URL environment variable is not set.")
        sys.exit(1)
        
    try:
        print("Connecting to Supabase database...")
        conn = psycopg2.connect(database_url, connect_timeout=15)
        cur = conn.cursor()
        
        print("Sending keep-alive query...")
        cur.execute("SELECT 1;")
        result = cur.fetchone()
        print(f"Query Result: {result}")
        
        # 簡單的健康檢查（計算 table 中的紀錄數）
        try:
            cur.execute("SELECT COUNT(*) FROM daily_prices;")
            count = cur.fetchone()[0]
            print(f"Database health check: daily_prices records count = {count}")
        except Exception:
            # 若 table 還沒建立也不會報錯中斷
            print("Table daily_prices does not exist yet.")
            
        cur.close()
        conn.close()
        print("Successfully kept Supabase database alive!")
        
    except Exception as e:
        print(f"Database connection failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
