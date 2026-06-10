# from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
# from fastapi.middleware.cors import CORSMiddleware
# from sqlalchemy.orm import Session
# import models
# from database import engine, get_db
# import json
# from datetime import datetime, timedelta
# from twilio.rest import Client


# models.Base.metadata.create_all(bind=engine)
# app = FastAPI()
# app = FastAPI(title="iTALKS Backend API", description="iTALKS ke liye FastAPI backend jo Twilio Verify API use karta hai OTP ke liye, aur SQLAlchemy for database interactions. WebSocket support bhi hai real-time messaging ke liye.", version="1.0.0")

# # CORS Middleware (Ye Vercel ko allow karega)
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"], 
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# #app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# connected_clients = []

# # ==========================================
# # 🛑 TWILIO VERIFY API CREDENTIALS
# # ==========================================
# import os
# from dotenv import load_dotenv

# # .env file load karo
# load_dotenv()

# import os

# # Twilio imports aur variables hatado
# @app.post("/verify-otp")
# def verify_otp(data: dict, db: Session = Depends(get_db)):
#     phone = data.get("phone")
#     username = data.get("username", "")
    
#     db_user = db.query(models.User).filter(models.User.phone == phone).first()
#     if not db_user:
#         if not username: return {"isNewUser": True}
#         db_user = models.User(username=username, phone=phone, about="Hey! I am using iTALKS")
#         db.add(db_user)
#         db.commit()
#         db.refresh(db_user)
    
#     return {"username": db_user.username, "clientId": str(db_user.id), "avatar": db_user.avatar, "about": db_user.about}
# # ... (Baki websocket/message routes wahi purane wale hi rahenge)

# @app.post("/update-profile")
# def update_profile(data: dict, db: Session = Depends(get_db)):
#     db_user = db.query(models.User).filter(models.User.id == int(data["user_id"])).first()
#     if db_user:
#         if "avatar" in data: db_user.avatar = data["avatar"]
#         if "about" in data: db_user.about = data["about"]
#         db.commit()
#         return {"message": "Updated"}
#     raise HTTPException(status_code=404, detail="User not found")

# @app.get("/messages")
# def get_messages(db: Session = Depends(get_db)):
#     return db.query(models.Message).all()

# @app.get("/statuses")
# def get_statuses(db: Session = Depends(get_db)):
#     twenty_four_hours_ago = datetime.utcnow() - timedelta(hours=24)
#     return db.query(models.Status).filter(models.Status.timestamp >= twenty_four_hours_ago).order_by(models.Status.timestamp.desc()).all()

# @app.websocket("/ws")
# async def websocket_endpoint(websocket: WebSocket, db: Session = Depends(get_db)):
#     await websocket.accept()
#     connected_clients.append(websocket)
#     try:
#         while True:
#             data = await websocket.receive_text()
#             message_data = json.loads(data)

#             if message_data.get("type") == "read_receipt":
#                 msg_id = message_data.get("message_id")
#                 db_msg = db.query(models.Message).filter(models.Message.id == msg_id).first()
#                 if db_msg:
#                     db_msg.is_read = True
#                     db.commit()
#                 for client in connected_clients:
#                     if client != websocket:
#                         await client.send_text(data)

#             elif message_data.get("type") == "new_status":
#                 new_status = models.Status(username=message_data.get("username"), avatar=message_data.get("avatar"), content=message_data.get("content"), mediaType=message_data.get("mediaType"))
#                 db.add(new_status)
#                 db.commit()
#                 db.refresh(new_status)
#                 broadcast_data = message_data
#                 broadcast_data["id"] = new_status.id
#                 for client in connected_clients:
#                     if client != websocket: await client.send_text(json.dumps(broadcast_data))

#             elif message_data.get("type") in ["text", "image", "audio"]:
#                 new_msg = models.Message(clientId=str(message_data.get("clientId")), type=message_data.get("type"), content=message_data.get("content"))
#                 db.add(new_msg)
#                 db.commit()
#                 db.refresh(new_msg)
#                 broadcast_data = message_data
#                 broadcast_data["id"] = new_msg.id
#                 for client in connected_clients:
#                     if client != websocket: await client.send_text(json.dumps(broadcast_data))
#             else:
#                 for client in connected_clients:
#                     if client != websocket: await client.send_text(data)
#     except WebSocketDisconnect:
#         connected_clients.remove(websocket)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import models
from database import engine, get_db
import json
from datetime import datetime, timedelta

models.Base.metadata.create_all(bind=engine)
app = FastAPI(title="iTALKS Backend API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

connected_clients = []

@app.post("/verify-otp")
def verify_otp(data: dict, db: Session = Depends(get_db)):
    phone = data.get("phone")
    username = data.get("username", "")
    
    # Firebase ne verification kar liya hai, hum bas user ko database mein search karenge
    db_user = db.query(models.User).filter(models.User.phone == phone).first()
    if not db_user:
        if not username: return {"isNewUser": True}
        db_user = models.User(username=username, phone=phone, about="Hey! I am using iTALKS")
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
    
    return {"username": db_user.username, "clientId": str(db_user.id), "avatar": db_user.avatar, "about": db_user.about}

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
                    if client != websocket: await client.send_text(data)
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