import requests
from app.config import settings

FAST2SMS_URL = "https://www.fast2sms.com/dev/bulkV2"


def _clean_number(phone_number: str) -> str:
    """Fast2SMS wants bare 10-digit Indian numbers, no +91 / country code."""
    digits = "".join(c for c in phone_number if c.isdigit())
    if len(digits) > 10:
        digits = digits[-10:]
    return digits


def send_sms(phone_number: str, message: str) -> dict:
    """
    Sends an SMS via Fast2SMS. Returns a dict with at least:
      { "status": "sent" | "failed", "detail": <raw response or error text> }
    Never raises — callers (the notifications router) log the result either way.
    """
    if not settings.fast2sms_api_key:
        return {"status": "failed", "detail": "FAST2SMS_API_KEY not configured"}

    number = _clean_number(phone_number)
    if len(number) != 10:
        return {"status": "failed", "detail": f"invalid phone number: {phone_number}"}

    payload = {
        "route": "q",
        "message": message,
        "language": "english",
        "flash": 0,
        "numbers": number,
    }
    headers = {
        "authorization": settings.fast2sms_api_key,
        "Content-Type": "application/x-www-form-urlencoded",
    }

    try:
        response = requests.post(FAST2SMS_URL, data=payload, headers=headers, timeout=10)
        body = response.json()
        if response.status_code == 200 and body.get("return") is True:
            return {"status": "sent", "detail": str(body)}
        return {"status": "failed", "detail": str(body)}
    except requests.RequestException as exc:
        return {"status": "failed", "detail": str(exc)}
