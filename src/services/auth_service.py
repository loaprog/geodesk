from sqlalchemy import select

from sqlalchemy.ext.asyncio import AsyncSession

from src.models import User

from src.auth.security import verify_password


async def authenticate(
    db: AsyncSession,
    username: str,
    password: str,
):
    r = await db.execute(
        select(User).where(
            User.username == username
        )
    )

    u = r.scalar_one_or_none()

    return (
        u
        if (
            u
            and u.is_active
            and verify_password(
                password,
                u.password_hash,
            )
        )
        else None
    )