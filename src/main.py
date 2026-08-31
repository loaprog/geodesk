from pathlib import Path
from fastapi import (FastAPI,Request,)
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from src.configs.settings import settings
from src.routers.auth import router as auth_router
from src.routers.projects import router as projects_router

BASE = Path(__file__).resolve().parent.parent

app = FastAPI(title=settings.APP_NAME)
app.add_middleware(SessionMiddleware,secret_key=settings.SECRET_KEY,session_cookie=settings.SESSION_COOKIE_NAME,https_only=settings.APP_ENV == "production",same_site="lax",max_age=28800)

app.mount("/static",StaticFiles(directory=BASE / "frontend/static"),name="static",)

app.include_router(auth_router)
app.include_router(projects_router)


@app.get("/",include_in_schema=False,)
async def root(request: Request):
    if request.session.get("user_id"):
        return RedirectResponse("/dashboard")
    
    return RedirectResponse("/login")