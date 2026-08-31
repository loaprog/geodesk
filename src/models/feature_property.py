import uuid

from sqlalchemy import (
    String,
    ForeignKey,
    JSON,
)

from sqlalchemy.dialects.postgresql import UUID

from sqlalchemy.orm import (
    Mapped,
    mapped_column,
)

from src.database.database import Base


class FeatureProperty(Base):

    __tablename__ = "feature_properties"

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

    key: Mapped[str] = mapped_column(
        String(100)
    )

    value = mapped_column(
        JSON,
        nullable=True,
    )