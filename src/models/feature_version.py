import uuid

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    JSON,
    Integer,
    String,
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


class FeatureVersion(Base):

    __tablename__ = "feature_versions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    feature_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "features.id",
            ondelete="CASCADE",
        ),
        index=True,
    )

    version: Mapped[int] = mapped_column(
        Integer
    )

    operation: Mapped[str] = mapped_column(
        String(30)
    )

    geometry = mapped_column(
        Geometry(
            "GEOMETRY",
            srid=4326,
        )
    )

    properties: Mapped[dict] = mapped_column(
        JSON,
        default=dict,
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
        ),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    feature = relationship(
        "Feature",
        back_populates="versions",
    )