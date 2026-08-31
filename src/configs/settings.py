from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):

    APP_NAME: str = "GeoDesk"
    APP_ENV: str = "development"

    SECRET_KEY: str

    DATABASE_URL: str

    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin"

    SESSION_COOKIE_NAME: str = "webgis_session"

    MAPBOX_TOKEN: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
    )


settings = Settings()