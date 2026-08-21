"""
Server-side Groq call backing the "ML Risk Engine" panel on the
dashboard. Runs on the backend so the API key never reaches the
browser bundle.
"""

from groq import Groq
from app.config import settings
from app.schemas.ai_analysis import RiskAnalysisRequest

_client: Groq | None = None
_MODEL = "openai/gpt-oss-20b"


def _get_client() -> Groq | None:
    global _client
    if not settings.groq_api_key:
        return None
    if _client is None:
        _client = Groq(api_key=settings.groq_api_key)
    return _client


def generate_risk_analysis(req: RiskAnalysisRequest) -> str:
    client = _get_client()
    if client is None:
        return "No API key configured. Set GROQ_API_KEY on the backend to enable live AI analysis."

    alert_lines = "\n".join(
        f"- [{a.severity.upper()}] {a.type} at {a.location}: {a.summary}"
        for a in req.alerts
    ) or "No active disruptions."

    top_line = ""
    if req.top_location and req.top_score is not None:
        top_line = f'Highest ML risk: "{req.top_location}" scored {req.top_score}/100 ({req.top_confidence}% confidence).'

    prompt = f"""You are UNILOG, a supply chain intelligence system for Indian maritime logistics.

Active disruptions ({len(req.alerts)} events):
{alert_lines}

{top_line}

Context: India routes 95% of trade by sea. Red Sea crisis -> 8x freight spike. Exports contracted 9.3% Aug 2024.

Write 2-3 concise operational sentences for Indian freight operators. Be specific and direct."""

    try:
        response = client.chat.completions.create(
            model=_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
        )
        return (response.choices[0].message.content or "No response.").strip()
    except Exception as e:
        return f"Error: {e}"
