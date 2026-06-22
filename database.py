import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, Integer, String, Date, Float, BigInteger, DateTime, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import datetime

# Load environment variables from .env if present
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

DB_ENABLED = False
engine = None
SessionLocal = None
Base = declarative_base()

if DATABASE_URL:
    try:
        # Check if the dialect needs to be corrected (e.g. postgres:// vs postgresql://)
        if DATABASE_URL.startswith("postgres://"):
            DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
        
        # SQLite needs special argument for thread safety, PostgreSQL does not
        connect_args = {}
        if DATABASE_URL.startswith("sqlite"):
            connect_args = {"check_same_thread": False}
            
        # PostgreSQL 連線池優化（減少每次請求的 TCP 握手開銷）
        # SQLite 不支援連線池，需分別處理
        if DATABASE_URL.startswith("sqlite"):
            engine = create_engine(
                DATABASE_URL,
                connect_args=connect_args,
                pool_pre_ping=True
            )
        else:
            engine = create_engine(
                DATABASE_URL,
                connect_args=connect_args,
                pool_pre_ping=True,   # 自動重連已斷線的連線
                pool_size=5,          # 保持 5 條持久連線
                max_overflow=10,      # 高峰時最多額外開 10 條
                pool_recycle=300,     # 每 5 分鐘回收連線（避免 Supabase 閒置斷線）
            )
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        DB_ENABLED = True
        print(f"[Database] Successfully initialized database engine with: {DATABASE_URL.split('@')[-1] if '@' in DATABASE_URL else DATABASE_URL}")
    except Exception as e:
        print(f"[Database] Failed to initialize database: {e}")
        DB_ENABLED = False
else:
    print("[Database] DATABASE_URL is not set. Running in Fallback Mode (Direct yfinance fetch).")

class DailyPrice(Base):
    __tablename__ = "daily_prices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(15), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    close_price = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("symbol", "date", name="uix_symbol_date_daily"),
    )

class WeeklyPrice(Base):
    __tablename__ = "weekly_prices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(15), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    open_price = Column(Float, nullable=False)
    high_price = Column(Float, nullable=False)
    low_price = Column(Float, nullable=False)
    close_price = Column(Float, nullable=False)
    volume = Column(BigInteger, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("symbol", "date", name="uix_symbol_date_weekly"),
    )

class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(15), nullable=False, unique=True, index=True)
    name = Column(String(100), nullable=False)
    display_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

def init_db():
    """Create tables if they do not exist."""
    if DB_ENABLED and engine is not None:
        try:
            Base.metadata.create_all(bind=engine)
            print("[Database] Tables checked/created successfully.")
        except Exception as e:
            print(f"[Database] Error creating tables: {e}")
            
def get_db():
    """Dependency helper to get a database session."""
    if not DB_ENABLED or SessionLocal is None:
        return None
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
