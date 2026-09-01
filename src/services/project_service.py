from uuid import UUID

from sqlalchemy import delete, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Layer, Project, ProjectMember, ProjectSetting, User


async def list_projects(db: AsyncSession, user_id: UUID) -> list[Project]:
    result = await db.execute(
        select(Project)
        .outerjoin(ProjectMember, ProjectMember.project_id == Project.id)
        .where(
            Project.deleted_at.is_(None),
            or_(Project.owner_id == user_id, ProjectMember.user_id == user_id),
        )
        .distinct()
        .order_by(Project.updated_at.desc(), Project.created_at.desc())
    )
    return list(result.scalars().all())


async def get_project(
    db: AsyncSession,
    project_id: UUID,
    user_id: UUID,
) -> Project | None:
    result = await db.execute(
        select(Project)
        .outerjoin(ProjectMember, ProjectMember.project_id == Project.id)
        .where(
            Project.id == project_id,
            Project.deleted_at.is_(None),
            or_(Project.owner_id == user_id, ProjectMember.user_id == user_id),
        )
        .distinct()
    )
    return result.scalar_one_or_none()


async def get_owned_project(
    db: AsyncSession,
    project_id: UUID,
    owner_id: UUID,
) -> Project | None:
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.owner_id == owner_id,
            Project.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def get_project_by_share_token(db: AsyncSession, token: str) -> Project | None:
    result = await db.execute(
        select(Project).where(
            Project.share_token == token,
            Project.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def create_project(db: AsyncSession, owner_id: UUID, name: str) -> Project:
    project = Project(name=name, owner_id=owner_id)
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


async def rename_project(db: AsyncSession, project: Project, name: str) -> Project:
    project.name = name
    await db.commit()
    await db.refresh(project)
    return project


async def delete_project(db: AsyncSession, project: Project) -> None:
    # Exclusão explícita para funcionar mesmo quando o banco existente não
    # possui todas as constraints ON DELETE CASCADE da versão atual.
    pid = str(project.id)
    await db.execute(delete(ProjectMember).where(ProjectMember.project_id == project.id))
    await db.execute(delete(ProjectSetting).where(ProjectSetting.project_id == project.id))
    await db.execute(
        text("DELETE FROM feature_versions WHERE feature_id IN (SELECT id FROM features WHERE layer_id IN (SELECT id FROM layers WHERE project_id = :pid))"),
        {"pid": pid},
    )
    await db.execute(
        text("DELETE FROM feature_properties WHERE feature_id IN (SELECT id FROM features WHERE layer_id IN (SELECT id FROM layers WHERE project_id = :pid))"),
        {"pid": pid},
    )
    await db.execute(text("DELETE FROM features WHERE layer_id IN (SELECT id FROM layers WHERE project_id = :pid)"), {"pid": pid})
    await db.execute(delete(Layer).where(Layer.project_id == project.id))
    await db.delete(project)
    await db.commit()


async def set_public(db: AsyncSession, project: Project, is_public: bool) -> Project:
    project.is_public = is_public
    await db.commit()
    await db.refresh(project)
    return project


async def add_member(
    db: AsyncSession,
    project: Project,
    username: str,
    role: str = "viewer",
) -> tuple[bool, str]:
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if not user:
        return False, "Usuário não encontrado."

    if user.id == project.owner_id:
        return False, "O proprietário já tem acesso ao projeto."

    existing = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == user.id,
        )
    )
    member = existing.scalar_one_or_none()
    if member:
        member.role = role
    else:
        db.add(ProjectMember(project_id=project.id, user_id=user.id, role=role))

    await db.commit()
    return True, f"Acesso concedido para {user.username}."
