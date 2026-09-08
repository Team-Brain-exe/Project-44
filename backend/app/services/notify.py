import requests
from app.config import settings

FAST2SMS_URL = "https://www.fast2sms.com/dev/bulkV2"


def _clean_number(phone_number: str) -> str:
    """Fast2SMS wants bare 10-digit Indian numbers, no +91 / country code."""
    digits = "".join(c for c in phone_number if c.isdigit())
    if len(digits) > 10:
        digits = digits[-10:]
    return digits


def _simulate(reason: str) -> dict:
    """
    Demo-mode fallback: rather than surfacing a broken SMS gateway mid-demo
    (expired trial credits, unapproved DLT sender ID, missing key, etc.),
    record the notification as sent so the alert flow still looks and
    behaves correctly. Mirrors the SIM· fallback already used for
    vessels/aircraft when a live feed has no data.
    """
    return {"status": "simulated", "detail": f"DEMO MODE (SIM\u00b7): {reason}"}


def send_sms(phone_number: str, message: str) -> dict:
    """
    Sends an SMS via Fast2SMS. Returns a dict with at least:
      { "status": "sent" | "simulated" | "failed", "detail": <raw response or error text> }
    Never raises -- callers (the notifications router) log the result either way.

    In demo mode (settings.demo_mode, on by default), any failure to
    actually deliver -- missing key, invalid number, gateway error -- falls
    back to a clearly labeled "simulated" success instead of "failed", so a
    dead SMS credit balance never derails a live demo. Set DEMO_MODE=false
    to see real failures again once you're past the demo.
    """
    if not settings.fast2sms_api_key:
        if settings.demo_mode:
            return _simulate("FAST2SMS_API_KEY not configured")
        return {"status": "failed", "detail": "FAST2SMS_API_KEY not configured"}

    number = _clean_number(phone_number)
    if len(number) != 10:
        detail = f"invalid phone number: {phone_number}"
        if settings.demo_mode:
            return _simulate(detail)
        return {"status": "failed", "detail": detail}

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
        if settings.demo_mode:
            return _simulate(str(body))
        return {"status": "failed", "detail": str(body)}
    except requests.RequestException as exc:
        if settings.demo_mode:
            return _simulate(str(exc))
        return {"status": "failed", "detail": str(exc)}
