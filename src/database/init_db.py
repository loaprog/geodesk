import asyncio

from argon2 import PasswordHasher
from sqlalchemy import select, text

from src.configs.settings import settings
from src.database.database import Base, SessionLocal, engine
from src.models import User


async def init():
    async with engine.begin() as c:
        await c.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        await c.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        await c.run_sync(Base.metadata.create_all)
        # Compatibilidade com bancos criados por versões anteriores do MVP.
        await c.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_token VARCHAR(64)"))
        await c.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE"))
        await c.execute(text("UPDATE projects SET share_token = replace(gen_random_uuid()::text, '-', '') WHERE share_token IS NULL"))
        await c.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_projects_share_token ON projects (share_token)"))

    async with SessionLocal() as db:
        r = await db.execute(select(User).where(User.username == settings.ADMIN_USERNAME))
        if not r.scalar_one_or_none():
            db.add(User(
                username=settings.ADMIN_USERNAME,
                password_hash=PasswordHasher().hash(settings.ADMIN_PASSWORD),
            ))
            await db.commit()


if __name__ == "__main__":
    asyncio.run(init())
