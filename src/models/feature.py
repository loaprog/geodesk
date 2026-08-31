import uuid

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    JSON,
    Integer,
    func,
)

from sqlalchemy.dialects.postgresql import UUID

from geoalchemy2 import Geometry

from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship,
)

from src.database.database import Base


class Feature(Base):

    __tablename__ = "features"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    layer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "layers.id",
            ondelete="CASCADE",
        ),
        index=True,
    )

    geometry = mapped_column(
        Geometry(
            "GEOMETRY",
            srid=4326,
            spatial_index=True,
        ),
        nullable=False,
    )

    properties: Mapped[dict] = mapped_column(
        JSON,
        default=dict,
    )

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
        ),
    )

    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
        ),
    )

    version: Mapped[int] = mapped_column(
        Integer,
        default=1,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )

    layer = relationship(
        "Layer",
        back_populates="features",
    )

    versions = relationship(
        "FeatureVersion",
        back_populates="feature",
        cascade="all, delete-orphan",
    )