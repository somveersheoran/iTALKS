from pydantic import BaseModel

class UserCreate(BaseModel):
    username: str
    email: str
    password: str

# NEW: Schema for logging in
class UserLogin(BaseModel):
    username: str
    password: str