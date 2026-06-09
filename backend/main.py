from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import models
from database import engine, get_db
import json
from datetime import datetime, timedelta
from twilio.rest import Client


# Agar pehle se app = FastAPI() likha hai toh use waise hi rehne do
# Usko neeche ye middleware add kar do:

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Ye Vercel, Localhost sabko allow kar dega
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

models.Base.metadata.create_all(bind=engine)
app = FastAPI()

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

connected_clients = []

# ==========================================
# 🛑 TWILIO VERIFY API CREDENTIALS
# ==========================================
import os
from dotenv import load_dotenv

# .env file load karo
load_dotenv()

# Keys access karo
twilio_sid = os.getenv("TWILIO_ACCOUNT_SID")
twilio_token = os.getenv("TWILIO_AUTH_TOKEN")
twilio_verify_sid = os.getenv("VERIFY_SERVICE_SID")
db_url = os.getenv("DATABASE_URL") # Yeh Service SID hai
# ==========================================

@app.post("/send-otp")
def send_otp(data: dict):
    phone = data.get("phone")
    client = Client(twilio_sid, twilio_token)
    
    try:
        # Twilio Verify API call - Yeh automatic SMS bhejega
        client.verify.v2.services(twilio_verify_sid).verifications.create(to=phone, channel='sms')
        print(f"✅ OTP sent successfully to {phone} using Verify API")
        return {"message": "OTP sent successfully"}
    except Exception as e:
        print(f"❌ Twilio Verify Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/verify-otp")
def verify_otp(data: dict, db: Session = Depends(get_db)):
    phone = data.get("phone")
    otp = data.get("otp")
    username = data.get("username", "")
    
    client = Client(twilio_sid, twilio_token)
    
    try:
        # OTP verify check
        check = client.verify.v2.services(twilio_verify_sid).verification_checks.create(to=phone, code=otp)
        
        if check.status != 'approved':
            raise HTTPException(status_code=400, detail="Invalid OTP!")

        db_user = db.query(models.User).filter(models.User.phone == phone).first()
        if not db_user:
            if not username: return {"isNewUser": True}
            db_user = models.User(username=username, phone=phone, about="Hey! I am using iTALKS")
            db.add(db_user)
            db.commit()
            db.refresh(db_user)
        
        return {"username": db_user.username, "clientId": str(db_user.id), "avatar": db_user.avatar, "about": db_user.about}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ... (Baki websocket/message routes wahi purane wale hi rahenge)

@app.post("/update-profile")
def update_profile(data: dict, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.id == int(data["user_id"])).first()
    if db_user:
        if "avatar" in data: db_user.avatar = data["avatar"]
        if "about" in data: db_user.about = data["about"]
        db.commit()
        return {"message": "Updated"}
    raise HTTPException(status_code=404, detail="User not found")

@app.get("/messages")
def get_messages(db: Session = Depends(get_db)):
    return db.query(models.Message).all()

@app.get("/statuses")
def get_statuses(db: Session = Depends(get_db)):
    twenty_four_hours_ago = datetime.utcnow() - timedelta(hours=24)
    return db.query(models.Status).filter(models.Status.timestamp >= twenty_four_hours_ago).order_by(models.Status.timestamp.desc()).all()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, db: Session = Depends(get_db)):
    await websocket.accept()
    connected_clients.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)

            if message_data.get("type") == "read_receipt":
                msg_id = message_data.get("message_id")
                db_msg = db.query(models.Message).filter(models.Message.id == msg_id).first()
                if db_msg:
                    db_msg.is_read = True
                    db.commit()
                for client in connected_clients:
                    if client != websocket:
                        await client.send_text(data)

            elif message_data.get("type") == "new_status":
                new_status = models.Status(username=message_data.get("username"), avatar=message_data.get("avatar"), content=message_data.get("content"), mediaType=message_data.get("mediaType"))
                db.add(new_status)
                db.commit()
                db.refresh(new_status)
                broadcast_data = message_data
                broadcast_data["id"] = new_status.id
                for client in connected_clients:
                    if client != websocket: await client.send_text(json.dumps(broadcast_data))

            elif message_data.get("type") in ["text", "image", "audio"]:
                new_msg = models.Message(clientId=str(message_data.get("clientId")), type=message_data.get("type"), content=message_data.get("content"))
                db.add(new_msg)
                db.commit()
                db.refresh(new_msg)
                broadcast_data = message_data
                broadcast_data["id"] = new_msg.id
                for client in connected_clients:
                    if client != websocket: await client.send_text(json.dumps(broadcast_data))
            else:
                for client in connected_clients:
                    if client != websocket: await client.send_text(data)
    except WebSocketDisconnect:
        connected_clients.remove(websocket)