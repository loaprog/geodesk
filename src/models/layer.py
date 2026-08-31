import uuid

from sqlalchemy import (
    String,
    Text,
    DateTime,
    ForeignKey,
    Integer,
    Boolean,
    Float,
    JSON,
    func,
)

from sqlalchemy.dialects.postgresql import UUID

from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship,
)

from src.database.database import Base


class Layer(Base):

    __tablename__ = "layers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "projects.id",
            ondelete="CASCADE",
        ),
        index=True,
    )

    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "layers.id",
            ondelete="SET NULL",
        ),
    )

    name: Mapped[str] = mapped_column(
        String(200)
    )

    description: Mapped[str | None] = mapped_column(
        Text
    )

    layer_type: Mapped[str] = mapped_column(
        String(20)
    )

    z_index: Mapped[int] = mapped_column(
        Integer,
        default=0,
    )

    visible: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
    )

    editable: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
    )

    locked: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
    )

    opacity: Mapped[float] = mapped_column(
        Float,
        default=1.0,
    )

    style: Mapped[dict] = mapped_column(
        JSON,
        default=dict,
    )

    created_at = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    updated_at = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    project = relationship(
        "Project",
        back_populates="layers",
    )

    features = relationship(
        "Feature",
        back_populates="layer",
        cascade="all, delete-orphan",
    )