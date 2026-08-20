from pydantic import BaseModel


class UserDeviceBase(BaseModel):
    label: str
    phone_number: str
    active: bool = True


class UserDeviceCreate(UserDeviceBase):
    pass


class UserDeviceOut(UserDeviceBase):
    id: int

    class Config:
        from_attributes = True


class UserDeviceUpdate(BaseModel):
    label: str | None = None
    phone_number: str | None = None
    active: bool | None = None
