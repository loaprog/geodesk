from pathlib import Path
from fastapi import (APIRouter,Request,Form,Depends)
from fastapi.responses import (HTMLResponse,RedirectResponse)
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession
from src.database.database import get_db
from src.services.auth_service import authenticate
from src.services.rate_limit import is_rate_limited, register_attempt, reset as reset_rate_limit

router = APIRouter()

templates = Jinja2Templates(
    directory=Path(__file__).resolve().parents[2]
    / "frontend/templates"
)


@router.get(
    "/login",
    response_class=HTMLResponse,
)
async def login_page(request: Request):

    if request.session.get("user_id"):
        return RedirectResponse(
            "/dashboard",
            303,
        )

    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context={
            "error": None,
        },
    )


@router.post(
    "/login",
    response_class=HTMLResponse,
)
async def login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
):

    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"{client_ip}:{username.strip().lower()}"

    limited, retry_after = is_rate_limited(rate_key)
    if limited:
        return templates.TemplateResponse(
            request=request,
            name="login.html",
            context={
                "error": f"Muitas tentativas de login. Tente novamente em {retry_after} segundos.",
            },
            status_code=429,
        )

    u = await authenticate(
        db,
        username.strip(),
        password,
    )

    if not u:
        register_attempt(rate_key)
        return templates.TemplateResponse(
            request=request,
            name="login.html",
            context={
                "error": "Usuário ou senha inválidos.",
            },
            status_code=401,
        )

    reset_rate_limit(rate_key)

    request.session.clear()

    request.session["user_id"] = str(u.id)
    request.session["username"] = u.username

    return RedirectResponse(
        "/dashboard",
        303,
    )


@router.post("/logout")
async def logout(request: Request):

    request.session.clear()

    return RedirectResponse(
        "/login",
        303,
    )