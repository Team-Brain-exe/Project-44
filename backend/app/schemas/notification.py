from pydantic import BaseModel


class NotificationOut(BaseModel):
    id: int
    alert_id: int | None = None
    device_id: int | None = None
    phone_number: str
    message: str
    status: str
    detail: str | None = None

    class Config:
        from_attributes = True


class NotificationSendRequest(BaseModel):
    alert_id: int
    message: str
