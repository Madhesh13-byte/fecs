@echo off
echo Running database migration to remove is_active from users table...
cd backend
alembic upgrade head
echo Migration completed!
pause
