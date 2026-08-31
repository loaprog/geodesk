import uuid

from sqlalchemy import (
    ForeignKey,
    JSON,
)

from sqlalchemy.dialects.postgresql import UUID

from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship,
)

from src.database.database import Base


class ProjectSetting(Base):

    __tablename__ = "project_settings"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "projects.id",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )

    settings: Mapped[dict] = mapped_column(
        JSON,
        default=dict,
    )

    project = relationship(
        "Project",
        back_populates="settings",
    )