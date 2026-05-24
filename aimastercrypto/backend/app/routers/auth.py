from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from app.core.auth import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    decode_token, get_current_user,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


# In-memory user store (replace with DB in production)
_users: dict = {}

# Admin emails — add yours here or set ADMIN_EMAILS env var
ADMIN_EMAILS = {"eduardohcorreia@hotmail.com"}

def get_role(email: str) -> str:
    return "admin" if email.lower() in ADMIN_EMAILS else "free"


@router.post("/register")
async def register(req: RegisterRequest):
    if req.email in _users:
        raise HTTPException(400, "Email already registered")
    role = get_role(req.email)
    _users[req.email] = {
        "email": req.email,
        "username": req.username,
        "hashed_password": hash_password(req.password),
        "role": role,
    }
    access = create_access_token({"sub": req.email, "username": req.username, "role": role})
    refresh = create_refresh_token({"sub": req.email})
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer",
            "user": {"email": req.email, "username": req.username, "role": role}}


@router.post("/login")
async def login(req: LoginRequest):
    user = _users.get(req.email)
    if not user or not verify_password(req.password, user["hashed_password"]):
        raise HTTPException(401, "Invalid credentials")
    access = create_access_token({"sub": req.email, "username": user["username"], "role": user["role"]})
    refresh = create_refresh_token({"sub": req.email})
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer",
            "user": {"email": req.email, "username": user["username"], "role": user["role"]}}


@router.post("/refresh")
async def refresh(req: RefreshRequest):
    payload = decode_token(req.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(401, "Invalid refresh token")
    email = payload.get("sub")
    user = _users.get(email)
    if not user:
        raise HTTPException(401, "User not found")
    access = create_access_token({"sub": email, "username": user["username"], "role": user["role"]})
    return {"access_token": access, "token_type": "bearer"}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    email = user.get("sub")
    db_user = _users.get(email, {})
    return {
        "email": email,
        "username": user.get("username"),
        "role": user.get("role", "free"),
        "language": db_user.get("language", "en"),
        "theme": db_user.get("theme", "dark"),
    }
