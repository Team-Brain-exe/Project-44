"""
Generates real, model-written reasoning for reroute suggestions using
Groq, replacing the static TOP_FEATURE_REASONS lookup table.

Falls back to a plain rule-based sentence if no API key is configured
or the API call fails, so the feature degrades gracefully rather than
breaking reroute generation entirely.
"""

from groq import Groq
from app.config import settings

_client: Groq | None = None
_MODEL = "openai/gpt-oss-20b"


def _get_client() -> Groq | None:
    global _client
    if not settings.groq_api_key:
        return None
    if _client is None:
        _client = Groq(api_key=settings.groq_api_key)
    return _client


def generate_ai_reason(route, risk_result: dict, alerts: list) -> str | None:
    client = _get_client()
    if client is None:
        return None

    alert_lines = "\n".join(
        f"- [{a.severity}/5] {a.type} at {a.location}: {a.summary}"
        for a in alerts
    ) or "No specific alerts, general elevated risk features."

    prompt = f"""You are a maritime logistics risk analyst. Write ONE concise sentence (under 25 words) explaining why this shipping route currently needs an alternate path.

Route: {route.origin} to {route.destination} via {route.via}
ML risk score: {risk_result['score']}/100 (confidence {risk_result['confidence']})
Contributing factors: {risk_result['features']}

Active alerts on this route:
{alert_lines}

Reply with ONLY the one sentence, no preamble, no quotes."""

    try:
        response = client.chat.completions.create(
            model=_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=100,
        )
        text = (response.choices[0].message.content or "").strip()
        return text if text else None
    except Exception as e:
        print(f"[ai_reroute] Groq call failed: {e}")
        return None
