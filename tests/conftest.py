"""Fixtures compartilhadas para a suíte de testes do GeoDesk.

Os testes de integração (API) precisam de um Postgres com a extensão PostGIS,
igual ao banco usado em desenvolvimento (ver docker-compose.yml). Configure a
variável de ambiente DATABASE_URL apontando para esse banco antes de rodar,
por exemplo:

    export DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/geodesk_test

Os testes criam e derrubam o schema a cada execução, então use um banco dedicado
para testes (nunca aponte para o banco de produção/desenvolvimento).
"""

import uuid

import pytest
import pytest_asyncio
from argon2 import PasswordHasher
from httpx import AsyncClient, ASGITransport
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from src.configs.settings import settings
from src.database.database import Base
from src.models import User


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(settings.DATABASE_URL)
    async with eng.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def db_session(engine):
    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    async with session_maker() as session:
        yield session


@pytest_asyncio.fixture
async def test_user(db_session):
    user = User(
        id=uuid.uuid4(),
        username="teste.user",
        password_hash=PasswordHasher().hash("senha-forte-123"),
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def app(engine):
    # Garante que o app e as rotas usem o mesmo engine/schema criado para o teste.
    from src.database import database as database_module
    import src.main as main_module

    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with session_maker() as session:
            yield session

    main_module.app.dependency_overrides[database_module.get_db] = override_get_db
    yield main_module.app
    main_module.app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def logged_in_client(client, test_user):
    response = await client.post(
        "/login",
        data={"username": test_user.username, "password": "senha-forte-123"},
    )
    assert response.status_code in (303, 200)
    return client
