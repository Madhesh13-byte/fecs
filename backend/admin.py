import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

import bcrypt
from app.database import SessionLocal, engine
from app.models import Base, User, UserRole

Base.metadata.create_all(bind=engine)

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def create_admin(username: str, password: str, email: str = None, employee_id: str = None):
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == username).first()
        if existing:
            print(f"User '{username}' already exists.")
            return

        user = User(
            username=username,
            password_hash=hash_password(password),
            role=UserRole.ADMIN,
            email=email,
            employee_id=employee_id,
        )
        db.add(user)
        db.commit()
        print(f"Admin user '{username}' created successfully.")
    finally:
        db.close()

if __name__ == "__main__":
    create_admin(
        username="admin",
        password="admin123",
        email="admin@example.com",
        employee_id="EMP001",
    )