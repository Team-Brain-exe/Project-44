from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./project44.db"
    twilio_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    ml_model_path: str = "app/ml/artifacts/model.pkl"

    class Config:
        env_file = ".env"


settings = Settings()
