from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./project44.db"
    fast2sms_api_key: str = ""
    ml_model_path: str = "app/ml/artifacts/model.pkl"
    frontend_url: str = ""
    gemini_api_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
