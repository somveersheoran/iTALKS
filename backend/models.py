from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from database import Base
from datetime import datetime

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, index=True)
    phone = Column(String, unique=True, index=True) # Yahan phone add ho gaya
    about = Column(String, default="Hey! I am using iTALKS") # Yahan about add ho gaya
    avatar = Column(Text, nullable=True)

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    clientId = Column(String)
    type = Column(String)
    content = Column(Text)
    is_read = Column(Boolean, default=False)

class Status(Base):
    __tablename__ = "statuses"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String)
    avatar = Column(Text, nullable=True)
    content = Column(Text)
    mediaType = Column(String)
    timestamp = Column(DateTime, default=datetime.utcnow)