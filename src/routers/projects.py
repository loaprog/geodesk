from pathlib import Path
from uuid import UUID
import json
import logging

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.configs.settings import settings
from src.database.database import get_db
from src.models import Feature, FeatureVersion, Layer, ProjectMember, ProjectSetting, User
from src.services.project_service import (
    add_member,
    create_project,
    delete_project,
    get_owned_project,
    get_project,
    get_project_by_share_token,
    list_projects,
    rename_project,
    set_public,
)

router = APIRouter()
logger = logging.getLogger("geodesk.projects")


def geojson_source_srid(data: dict) -> int:
    """Detecta o CRS legado do GeoJSON; os dados armazenados são sempre convertidos para WGS84."""
    crs=data.get("crs") or {}
    props=crs.get("properties") or {}
    name=str(props.get("name") or props.get("href") or "")
    import re
    match=re.search(r"EPSG(?:::|/|:)(?:0/)?(\d+)", name, re.I)
    if match:
        return int(match.group(1))
    if "CRS84" in name.upper() or "WGS 84" in name.upper():
        return 4326
    return 4326
templates = Jinja2Templates(directory=Path(__file__).resolve().parents[2] / "frontend/templates")


def current_user_id(request: Request) -> UUID:
    value = request.session.get("user_id")
    if not value:
        raise HTTPException(status_code=401)
    try:
        return UUID(value)
    except (TypeError, ValueError) as exc:
        request.session.clear()
        raise HTTPException(status_code=401) from exc


async def project_geojson(db: AsyncSession, project_id: UUID) -> dict:
    rows = await db.execute(
        select(
            Feature.id,
            Feature.layer_id,
            Feature.properties,
            func.ST_AsGeoJSON(Feature.geometry).label("geometry_json"),
        )
        .join(Layer, Layer.id == Feature.layer_id)
        .where(
            Layer.project_id == project_id,
            Feature.deleted_at.is_(None),
        )
    )
    features = []
    for row in rows:
        geometry = row.geometry_json
        if isinstance(geometry, str):
            import json
            geometry = json.loads(geometry)
        features.append({
            "type": "Feature",
            "id": str(row.id),
            "geometry": geometry,
            "properties": {**(row.properties or {}), "_layer_id": str(row.layer_id)},
        })
    return {"type": "FeatureCollection", "features": features}


async def layer_geojson(db: AsyncSession, project_id: UUID, layer_id: UUID) -> dict:
    rows = await db.execute(
        select(
            Feature.id,
            Feature.properties,
            func.ST_AsGeoJSON(Feature.geometry).label("geometry_json"),
        )
        .join(Layer, Layer.id == Feature.layer_id)
        .where(
            Layer.project_id == project_id,
            Layer.id == layer_id,
            Feature.deleted_at.is_(None),
        )
    )
    features = []
    import json
    for row in rows:
        geometry = row.geometry_json
        if isinstance(geometry, str):
            geometry = json.loads(geometry)
        features.append({
            "type": "Feature",
            "id": str(row.id),
            "geometry": geometry,
            "properties": row.properties or {},
        })
    return {"type": "FeatureCollection", "features": features}


async def snapshot_feature_version(db: AsyncSession, feature_id: UUID, operation: str, user_id: UUID | None) -> None:
    """Grava uma cópia do estado atual da feição em feature_versions antes de alterá-la,
    permitindo desfazer (undo) criações, edições e exclusões."""
    await db.execute(text("""
        INSERT INTO feature_versions (id, feature_id, version, operation, geometry, properties, user_id)
        SELECT gen_random_uuid(), id, version, :operation, geometry, properties, :user_id
        FROM features WHERE id = :feature_id
    """), {
        "feature_id": str(feature_id),
        "operation": operation,
        "user_id": str(user_id) if user_id else None,
    })


async def project_canvas_settings(db: AsyncSession, project_id: UUID) -> dict:
    result = await db.execute(select(ProjectSetting).where(ProjectSetting.project_id == project_id))
    setting = result.scalar_one_or_none()
    if not setting:
        return {}
    return dict(setting.settings or {})


async def save_canvas_settings(db: AsyncSession, project_id: UUID, payload: dict) -> dict:
    result = await db.execute(select(ProjectSetting).where(ProjectSetting.project_id == project_id))
    setting = result.scalar_one_or_none()
    if not setting:
        setting = ProjectSetting(project_id=project_id, settings={})
        db.add(setting)
    current = dict(setting.settings or {})
    current.update(payload)
    setting.settings = current
    await db.commit()
    await db.refresh(setting)
    return current


@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        return RedirectResponse("/login", 303)
    user_id = current_user_id(request)
    projects = await list_projects(db, user_id)
    return templates.TemplateResponse(request=request, name="dashboard.html", context={
        "username": request.session.get("username", "Usuário"), "projects": projects,
    })


@router.post("/projects")
async def create_project_route(request: Request, name: str = Form(...), db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        return RedirectResponse("/login", 303)
    name = name.strip()
    if not name:
        return RedirectResponse("/dashboard", 303)
    project = await create_project(db, current_user_id(request), name[:200])
    return RedirectResponse(f"/projects/{project.id}", 303)


@router.post("/projects/{project_id}/rename")
async def rename_project_route(request: Request, project_id: UUID, name: str = Form(...), db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        return RedirectResponse("/login", 303)
    project = await get_owned_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    name = name.strip()
    if name:
        await rename_project(db, project, name[:200])
    return RedirectResponse("/dashboard", 303)


@router.post("/projects/{project_id}/delete")
async def delete_project_route(request: Request, project_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        return RedirectResponse("/login", 303)
    project = await get_owned_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    await delete_project(db, project)
    return RedirectResponse("/dashboard", 303)


@router.put("/api/projects/{project_id}/name")
async def rename_project_api(request: Request, project_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_owned_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    payload = await request.json()
    name = str(payload.get("name", "")).strip()[:200]
    if not name:
        raise HTTPException(status_code=422, detail="Nome inválido")
    await rename_project(db, project, name)
    return JSONResponse({"id": str(project.id), "name": project.name})


@router.get("/projects/{project_id}", response_class=HTMLResponse)
async def open_project(request: Request, project_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        return RedirectResponse("/login", 303)
    project = await get_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    layers_result = await db.execute(
        select(Layer).where(Layer.project_id == project.id).order_by(Layer.z_index.desc(), Layer.created_at.asc())
    )
    layers = list(layers_result.scalars().all())
    return templates.TemplateResponse(request=request, name="project.html", context={
        "project": project,
        "username": request.session.get("username", "Usuário"),
        "layers": layers,
        "layer_ids": [str(layer.id) for layer in layers],
        "layer_config": [{"id": str(layer.id), "visible": bool(layer.visible), "name": layer.name, "z_index": layer.z_index, "style": layer.style or {}, "geometry_type": (layer.style or {}).get("geometry_type", "mixed")} for layer in layers],
        "project_id": str(project.id),
        "mapbox_token": settings.MAPBOX_TOKEN,
        "share_url": str(request.base_url).rstrip("/") + f"/share/{project.share_token}",
        "can_manage": project.owner_id == current_user_id(request),
        "canvas_settings": await project_canvas_settings(db, project.id),
    })


@router.get("/api/projects/{project_id}/preview")
async def project_preview_api(request: Request, project_id: UUID, db: AsyncSession = Depends(get_db)):
    """Prévia leve para o dashboard: não envia o GeoJSON completo das camadas grandes."""
    project = await get_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    result = await db.execute(text("""
        SELECT f.id, f.properties, ST_AsGeoJSON(
            CASE
                WHEN GeometryType(f.geometry) IN ('POLYGON','MULTIPOLYGON')
                    THEN ST_SimplifyPreserveTopology(f.geometry, 0.00005)
                ELSE ST_Simplify(f.geometry, 0.00005)
            END
        ) AS geometry_json
        FROM features f
        JOIN layers l ON l.id=f.layer_id
        WHERE l.project_id=:project_id AND f.deleted_at IS NULL
        ORDER BY f.created_at ASC
        LIMIT 500
    """), {"project_id": str(project.id)})
    features=[]
    for row in result:
        geometry=json.loads(row.geometry_json) if isinstance(row.geometry_json,str) else row.geometry_json
        if geometry:
            features.append({"type":"Feature","id":str(row.id),"geometry":geometry,"properties":row.properties or {}})
    return JSONResponse({"type":"FeatureCollection","features":features}, headers={"Cache-Control":"no-store, max-age=0"})


@router.get("/api/projects/{project_id}/geojson")
async def project_geojson_api(request: Request, project_id: UUID, db: AsyncSession = Depends(get_db)):
    project = await get_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    return JSONResponse(
        await project_geojson(db, project.id),
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.get("/api/projects/{project_id}/canvas")
async def canvas_state(request: Request, project_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    return JSONResponse(
        await project_canvas_settings(db, project.id),
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.put("/api/projects/{project_id}/canvas")
async def update_canvas_state(request: Request, project_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_owned_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    payload = await request.json()
    allowed = {k: payload[k] for k in ("drawings", "basemap_visible", "camera", "viewport") if k in payload}
    return JSONResponse(await save_canvas_settings(db, project.id, allowed))


@router.post("/api/projects/{project_id}/layers/import")
async def import_geo_layer(request: Request, project_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_owned_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    try:
        payload = await request.json()
        name = str(payload.get("name", "Camada Geo")).strip()[:200] or "Camada Geo"
        data = payload.get("data") or {}
        if data.get("type") != "FeatureCollection":
            raise HTTPException(status_code=422, detail="GeoJSON inválido: esperado FeatureCollection")
        features = data.get("features") or []
        geometry_types = sorted({str((f.get("geometry") or {}).get("type")) for f in features if (f.get("geometry") or {}).get("type")})
        if not features or not geometry_types:
            raise HTTPException(status_code=422, detail="GeoJSON sem geometrias válidas")
        source_srid=geojson_source_srid(data)
        logger.info("[GeoDesk] Importação recebida: projeto=%s nome=%s feições=%s tipos=%s EPSG=%s", project.id, name, len(features), geometry_types, source_srid)
        result = await db.execute(select(Layer).where(Layer.project_id == project.id))
        existing = list(result.scalars().all())
        z_index = max([l.z_index for l in existing], default=0) + 1
        style={"stroke":"#3FAE58","fill":"#3FAE58","fill_opacity":0.24,"geometry_type":geometry_types[0] if len(geometry_types)==1 else "mixed"}
        layer = Layer(project_id=project.id, name=name, layer_type="geojson", z_index=z_index, visible=True, style=style)
        db.add(layer)
        await db.flush()
        rows=[]
        for index, feature in enumerate(features):
            geometry = feature.get("geometry")
            if not geometry or not geometry.get("type") or "coordinates" not in geometry:
                logger.warning("[GeoDesk] Feição ignorada: projeto=%s nome=%s índice=%s", project.id, name, index)
                continue
            rows.append({
                "id": str(__import__("uuid").uuid4()),
                "layer_id": str(layer.id),
                "geometry": json.dumps(geometry),
                "properties": json.dumps(feature.get("properties") or {}),
            })
        if not rows:
            raise HTTPException(status_code=422, detail="Nenhuma feição válida foi inserida")
        # Uma única operação executemany é muito mais rápida para GeoJSONs grandes.
        for row in rows:
            row["source_srid"]=source_srid
        await db.execute(text("""
            INSERT INTO features (id, layer_id, geometry, properties, version)
            VALUES (:id, :layer_id, ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(:geometry), :source_srid), 4326), CAST(:properties AS jsonb), 1)
        """), rows)
        inserted=len(rows)
        await db.commit()
        await db.refresh(layer)
        feature_ids=[row["id"] for row in rows]
        logger.info("[GeoDesk] Camada importada: projeto=%s layer=%s nome=%s feições=%s tipos=%s EPSG=%s", project.id, layer.id, name, inserted, geometry_types, source_srid)
        return JSONResponse({
            "id": str(layer.id), "name": layer.name, "visible": layer.visible, "z_index": layer.z_index,
            "style": layer.style, "geometry_type": style["geometry_type"], "feature_count": inserted, "feature_ids": feature_ids,
        })
    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("[GeoDesk] ERRO AO IMPORTAR: projeto=%s", project_id)
        raise HTTPException(status_code=422, detail=f"Falha ao gravar GeoJSON: {exc}") from exc


@router.post("/api/projects/{project_id}/layers/empty")
async def create_empty_geo_layer(request: Request, project_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_owned_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    payload = await request.json()
    geometry_type = str(payload.get("geometry_type", "")).strip()
    if geometry_type not in {"Point", "LineString", "Polygon"}:
        raise HTTPException(status_code=422, detail="Tipo de camada vazia inválido")
    name = str(payload.get("name") or {"Point":"Pontos", "LineString":"Linhas", "Polygon":"Polígonos"}[geometry_type]).strip()[:200]
    result = await db.execute(select(Layer).where(Layer.project_id == project.id))
    existing = list(result.scalars().all())
    z_index = max([l.z_index for l in existing], default=0) + 1
    style={"stroke":"#3FAE58","fill":"#3FAE58","fill_opacity":0.24,"geometry_type":geometry_type,"empty":True}
    layer=Layer(project_id=project.id,name=name,layer_type="geojson",z_index=z_index,visible=True,style=style)
    db.add(layer)
    await db.commit()
    await db.refresh(layer)
    logger.info("[GeoDesk] Camada vazia criada: projeto=%s layer=%s nome=%s tipo=%s",project.id,layer.id,name,geometry_type)
    return JSONResponse({"id":str(layer.id),"name":layer.name,"visible":layer.visible,"z_index":layer.z_index,"style":layer.style,"geometry_type":geometry_type,"feature_count":0,"feature_ids":[]})

@router.get("/api/projects/{project_id}/layers/{layer_id}/geojson")
async def download_layer_geojson(request: Request, project_id: UUID, layer_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    result = await db.execute(select(Layer).where(Layer.id == layer_id, Layer.project_id == project.id))
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=404, detail="Camada não encontrada")
    data = await layer_geojson(db, project.id, layer.id)
    import json
    return JSONResponse(
        data,
        media_type="application/geo+json",
        headers={"Content-Disposition": f'attachment; filename="{layer.name[:100].replace(chr(34), "_")}.geojson"', "Cache-Control": "no-store, max-age=0"}
    )


@router.patch("/api/projects/{project_id}/layers/{layer_id}/style")
async def update_layer_style(request: Request, project_id: UUID, layer_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_owned_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    result = await db.execute(select(Layer).where(Layer.id == layer_id, Layer.project_id == project.id))
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=404, detail="Camada não encontrada")
    payload = await request.json()
    style = dict(layer.style or {})
    for key in ("stroke", "fill", "fill_opacity"):
        if key in payload:
            style[key] = payload[key]
    layer.style = style
    await db.commit()
    return JSONResponse({"id": str(layer.id), "style": style})


@router.put("/api/projects/{project_id}/online")
async def project_online(request: Request, project_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_owned_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    payload = await request.json()
    online = bool(payload.get("online", False))
    camera = payload.get("camera")
    if online and isinstance(camera, dict):
        await save_canvas_settings(db, project.id, {"camera": camera})
    await set_public(db, project, online)
    return JSONResponse({"id": str(project.id), "online": project.is_public, "camera": camera})


@router.patch("/api/projects/{project_id}/layers/{layer_id}")
async def update_layer(request: Request, project_id: UUID, layer_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_owned_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    result = await db.execute(select(Layer).where(Layer.id == layer_id, Layer.project_id == project.id))
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=404, detail="Camada não encontrada")
    payload = await request.json()
    if "name" in payload:
        name = str(payload["name"]).strip()[:200]
        if name:
            layer.name = name
    if "visible" in payload:
        layer.visible = bool(payload["visible"])
    await db.commit()
    await db.refresh(layer)
    return JSONResponse({"id": str(layer.id), "name": layer.name, "visible": layer.visible, "z_index": layer.z_index})


@router.put("/api/projects/{project_id}/layers/reorder")
async def reorder_layers(request: Request, project_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_owned_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    payload = await request.json()
    layer_ids = payload.get("layer_ids", [])
    try:
        parsed = [UUID(str(value)) for value in layer_ids]
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Ordem de camadas inválida") from exc
    result = await db.execute(select(Layer).where(Layer.project_id == project.id))
    layers = {layer.id: layer for layer in result.scalars().all()}
    # O frontend pode ter uma linha desatualizada durante uma atualização.
    # Preserve a ordem recebida e acrescente as camadas que ficaram fora.
    missing = [layer_id for layer_id in layers if layer_id not in set(parsed)]
    parsed.extend(sorted(missing, key=lambda lid: (layers[lid].z_index, str(lid))))
    for index, layer_id in enumerate(parsed):
        layers[layer_id].z_index = len(parsed) - index
    await db.commit()
    return JSONResponse({"ok": True, "layer_ids": [str(value) for value in parsed]})


@router.delete("/api/projects/{project_id}/layers/{layer_id}")
async def delete_layer(request: Request, project_id: UUID, layer_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_owned_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    result = await db.execute(select(Layer).where(Layer.id == layer_id, Layer.project_id == project.id))
    layer = result.scalar_one_or_none()
    if not layer:
        # DELETE é idempotente: se a camada já foi removida por outra ação,
        # o estado desejado já foi atingido.
        return JSONResponse({"ok": True, "already_deleted": True})
    await db.delete(layer)
    await db.commit()
    return JSONResponse({"ok": True})


@router.post("/api/projects/{project_id}/layers/{layer_id}/features")
async def create_layer_feature(request: Request, project_id: UUID, layer_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_owned_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    result = await db.execute(select(Layer).where(Layer.id == layer_id, Layer.project_id == project.id))
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=404, detail="Camada não encontrada")
    payload = await request.json()
    geometry = payload.get("geometry")
    if not isinstance(geometry, dict) or not geometry.get("type") or "coordinates" not in geometry:
        raise HTTPException(status_code=422, detail="Geometria inválida")
    supported={"Point","MultiPoint","LineString","MultiLineString","Polygon","MultiPolygon"}
    if geometry.get("type") not in supported:
        raise HTTPException(status_code=422, detail=f"Tipo de geometria não suportado: {geometry.get('type')}")
    feature_id = UUID(str(__import__("uuid").uuid4()))
    properties = dict(payload.get("properties") or {})
    try:
        await db.execute(text("""
            INSERT INTO features (id, layer_id, geometry, properties, version)
            VALUES (:id, :layer_id, ST_SetSRID(ST_GeomFromGeoJSON(:geometry),4326), CAST(:properties AS jsonb), 1)
        """), {"id":str(feature_id),"layer_id":str(layer.id),"geometry":json.dumps(geometry),"properties":json.dumps(properties)})
        await snapshot_feature_version(db, feature_id, "create", current_user_id(request))
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.exception("[GeoDesk] ERRO AO CRIAR FEIÇÃO: projeto=%s layer=%s tipo=%s", project.id, layer.id, geometry.get("type"))
        raise HTTPException(status_code=422, detail=f"Falha ao salvar geometria {geometry.get('type')}: {exc}") from exc
    properties["_layer_id"]=str(layer.id)
    logger.info("[GeoDesk] Feição criada: projeto=%s layer=%s feature=%s tipo=%s", project.id, layer.id, feature_id, geometry.get("type"))
    return JSONResponse({"ok":True,"id":str(feature_id),"feature":{"type":"Feature","id":str(feature_id),"geometry":geometry,"properties":properties}})


@router.put("/api/projects/{project_id}/features/{feature_id}")
async def update_feature_geometry(request: Request, project_id: UUID, feature_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    payload = await request.json()
    geometry = payload.get("geometry")
    if not isinstance(geometry, dict) or not geometry.get("type") or "coordinates" not in geometry:
        raise HTTPException(status_code=422, detail="Geometria inválida")
    result = await db.execute(
        select(Feature).join(Layer, Layer.id == Feature.layer_id).where(
            Feature.id == feature_id, Layer.project_id == project.id, Feature.deleted_at.is_(None)
        )
    )
    feature = result.scalar_one_or_none()
    if not feature:
        raise HTTPException(status_code=404, detail="Feição não encontrada")
    import json
    await snapshot_feature_version(db, feature_id, "update", current_user_id(request))
    await db.execute(text("""
        UPDATE features
        SET geometry = ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326),
            version = version + 1,
            updated_by = :user_id,
            updated_at = NOW()
        WHERE id = :feature_id
    """), {"geometry": json.dumps(geometry), "feature_id": str(feature_id), "user_id": str(current_user_id(request))})
    await db.commit()
    return JSONResponse({"ok": True, "id": str(feature_id)})


@router.delete("/api/projects/{project_id}/features/{feature_id}")
async def delete_feature(request: Request, project_id: UUID, feature_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    result = await db.execute(
        select(Feature).join(Layer, Layer.id == Feature.layer_id).where(
            Feature.id == feature_id, Layer.project_id == project.id, Feature.deleted_at.is_(None)
        )
    )
    feature = result.scalar_one_or_none()
    if not feature:
        raise HTTPException(status_code=404, detail="Feição não encontrada")
    from datetime import datetime, timezone
    await snapshot_feature_version(db, feature_id, "delete", current_user_id(request))
    feature.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return JSONResponse({"ok": True, "id": str(feature_id)})


@router.get("/api/projects/{project_id}/features/{feature_id}/history")
async def feature_history(request: Request, project_id: UUID, feature_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    result = await db.execute(
        select(FeatureVersion.id, FeatureVersion.version, FeatureVersion.operation, FeatureVersion.created_at, FeatureVersion.user_id)
        .join(Feature, Feature.id == FeatureVersion.feature_id)
        .join(Layer, Layer.id == Feature.layer_id)
        .where(FeatureVersion.feature_id == feature_id, Layer.project_id == project.id)
        .order_by(FeatureVersion.created_at.desc())
    )
    items = [
        {
            "id": str(row.id),
            "version": row.version,
            "operation": row.operation,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "user_id": str(row.user_id) if row.user_id else None,
        }
        for row in result.all()
    ]
    return JSONResponse({"items": items})


@router.post("/api/projects/{project_id}/features/{feature_id}/undo")
async def undo_feature(request: Request, project_id: UUID, feature_id: UUID, db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        raise HTTPException(status_code=401)
    project = await get_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    result = await db.execute(
        select(FeatureVersion)
        .join(Feature, Feature.id == FeatureVersion.feature_id)
        .join(Layer, Layer.id == Feature.layer_id)
        .where(FeatureVersion.feature_id == feature_id, Layer.project_id == project.id)
        .order_by(FeatureVersion.created_at.desc())
        .limit(1)
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Nada para desfazer nesta feição")

    if version.operation == "create":
        # Desfazer a criação remove a feição, já que ela nunca existiu antes dela.
        await db.execute(text("DELETE FROM feature_versions WHERE id = :vid"), {"vid": str(version.id)})
        await db.execute(text("DELETE FROM features WHERE id = :fid"), {"fid": str(feature_id)})
        await db.commit()
        return JSONResponse({"ok": True, "operation": "create", "deleted": True, "id": str(feature_id)})

    await db.execute(text("""
        UPDATE features
        SET geometry = (SELECT geometry FROM feature_versions WHERE id = :vid),
            properties = (SELECT properties FROM feature_versions WHERE id = :vid),
            version = (SELECT version FROM feature_versions WHERE id = :vid),
            deleted_at = NULL,
            updated_at = NOW()
        WHERE id = :fid
    """), {"vid": str(version.id), "fid": str(feature_id)})
    await db.execute(text("DELETE FROM feature_versions WHERE id = :vid"), {"vid": str(version.id)})
    await db.commit()

    row = (await db.execute(
        select(Feature.id, Feature.properties, func.ST_AsGeoJSON(Feature.geometry).label("geometry_json"))
        .where(Feature.id == feature_id)
    )).one_or_none()
    feature_payload = None
    if row:
        geometry = row.geometry_json
        if isinstance(geometry, str):
            geometry = json.loads(geometry)
        feature_payload = {"type": "Feature", "id": str(row.id), "geometry": geometry, "properties": row.properties or {}}
    return JSONResponse({"ok": True, "operation": version.operation, "restored": True, "feature": feature_payload})


@router.post("/projects/{project_id}/sharing/public")
async def public_sharing(request: Request, project_id: UUID, is_public: bool = Form(False), db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        return RedirectResponse("/login", 303)
    project = await get_owned_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    await set_public(db, project, is_public)
    return RedirectResponse(f"/projects/{project.id}", 303)


@router.post("/projects/{project_id}/share/member")
async def share_member(request: Request, project_id: UUID, username: str = Form(...), db: AsyncSession = Depends(get_db)):
    if not request.session.get("user_id"):
        return RedirectResponse("/login", 303)
    project = await get_owned_project(db, project_id, current_user_id(request))
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    await add_member(db, project, username.strip(), "viewer")
    return RedirectResponse(f"/projects/{project.id}", 303)


@router.get("/share/{share_token}", response_class=HTMLResponse)
async def public_project(request: Request, share_token: str, db: AsyncSession = Depends(get_db)):
    project = await get_project_by_share_token(db, share_token)
    if not project or not project.is_public:
        raise HTTPException(status_code=404, detail="Mapa não publicado")
    layers_result = await db.execute(
        select(Layer).where(Layer.project_id == project.id).order_by(Layer.z_index.desc(), Layer.created_at.asc())
    )
    layers = list(layers_result.scalars().all())
    return templates.TemplateResponse(request=request, name="public_project.html", context={
        "project": project,
        "layers": layers,
        "layer_ids": [str(layer.id) for layer in layers],
        "layer_config": [{"id": str(layer.id), "name": layer.name, "visible": bool(layer.visible), "z_index": layer.z_index, "style": layer.style or {}, "geometry_type": (layer.style or {}).get("geometry_type", "mixed")} for layer in layers],
        "mapbox_token": settings.MAPBOX_TOKEN,
        "share_url": str(request.base_url).rstrip("/") + f"/share/{project.share_token}",
        "canvas_settings": await project_canvas_settings(db, project.id),
    })


@router.get("/api/public/{share_token}/layers/{layer_id}/geojson")
async def download_public_layer_geojson(share_token: str, layer_id: UUID, db: AsyncSession = Depends(get_db)):
    project = await get_project_by_share_token(db, share_token)
    if not project or not project.is_public:
        raise HTTPException(status_code=404, detail="Mapa não publicado")
    result = await db.execute(select(Layer).where(Layer.id == layer_id, Layer.project_id == project.id))
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=404, detail="Camada não encontrada")
    data = await layer_geojson(db, project.id, layer.id)
    return JSONResponse(
        data,
        media_type="application/geo+json",
        headers={"Content-Disposition": f'attachment; filename="{layer.name[:100].replace(chr(34), "_")}.geojson"', "Cache-Control": "no-store, max-age=0"}
    )


@router.get("/api/public/{share_token}/canvas")
async def public_canvas(share_token: str, db: AsyncSession = Depends(get_db)):
    project = await get_project_by_share_token(db, share_token)
    if not project or not project.is_public:
        raise HTTPException(status_code=404, detail="Mapa não publicado")
    return JSONResponse(
        await project_canvas_settings(db, project.id),
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.get("/api/public/{share_token}/geojson")
async def public_geojson(share_token: str, db: AsyncSession = Depends(get_db)):
    project = await get_project_by_share_token(db, share_token)
    if not project or not project.is_public:
        raise HTTPException(status_code=404, detail="Mapa não publicado")
    return JSONResponse(
        await project_geojson(db, project.id),
        headers={"Cache-Control": "no-store, max-age=0"},
    )
