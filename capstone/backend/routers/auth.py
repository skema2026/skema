# backend/routers/auth.py
import os
import jwt  # pip install PyJWT
import datetime
from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from database import SessionLocal
import models
from passlib.context import CryptContext

router = APIRouter(prefix="/auth", tags=["auth"])

SECRET_KEY = os.getenv("JWT_SECRET", "CHANGE_THIS_TO_SOMETHING_SECURE")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def create_access_token(data: dict, expires_delta: int = ACCESS_TOKEN_EXPIRE_MINUTES):
    to_encode = data.copy()
    expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=expires_delta)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

@router.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """
    로그인:
    - OAuth2PasswordRequestForm -> form_data.username, form_data.password
    - username/password 검증 후 JWT 발급
    """
    user = db.query(models.User).filter_by(username=form_data.username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    # 비밀번호 해싱 검증
    if not pwd_context.verify(form_data.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    # JWT 생성
    access_token = create_access_token(data={"sub": str(user.id)})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user.id
    }

def get_current_user_token(authorization: str = Header(...), db: Session = Depends(get_db)):
    """
    - Authorization 헤더에서 'Bearer <token>' 추출
    - token을 디코딩해서 유저 정보 반환
    - 실패 시 401
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No or invalid token header")

    token = authorization[len("Bearer "):]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token payload")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(models.User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user

@router.get("/me")
def get_me(current_user: models.User = Depends(get_current_user_token)):
    """
    GET /auth/me
    JWT 토큰이 유효하면 현재 유저 정보 반환
    """
    return {"user_id": current_user.id, "username": current_user.username}
