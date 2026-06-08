import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

# Railway automatically ye variable dega. Local testing ke liye aage fallback diya hai.
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:iTqzNfbDjhNBJKNLkcuQTXUuvhxSCDGS@postgres.railway.internal:5432/railway")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()