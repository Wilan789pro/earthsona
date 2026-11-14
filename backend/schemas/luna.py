"""Request / response shapes for POST /api/luna/chat (validated by FastAPI + Pydantic)."""

from __future__ import annotations

import json
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

Mission = Literal["ocean", "forest", "pulse"]

MAX_CONTEXT_BYTES = 8_000  # send summaries, not datasets


class LunaContext(BaseModel):
    """What the app knows right now. Luna is told these facts; she never guesses the app state."""

    mission: Optional[Mission] = None
    place: Optional[str] = Field(default=None, max_length=120)
    experiment: Optional[str] = Field(default=None, max_length=120)
    # e.g. {"rainfall": {"value": 40, "baseline": 100, "unit": "%"}}
    sliders: Optional[dict[str, Any]] = None
    # Short summaries of real data, e.g. {"variable": "SST", "latest": 27.7, "unit": "°C", "date": "2024-12-30", "source": "NOAA CRW"}
    dataset: Optional[dict[str, Any]] = None
    observations: Optional[list[str]] = Field(default=None, max_length=20)
    # Outputs of EARTHSONA's simplified educational simulation (health, indicators); never observations.
    simulation: Optional[dict[str, Any]] = None

    @field_validator("sliders", "dataset", "simulation")
    @classmethod
    def _small(cls, v: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
        if v is not None and len(json.dumps(v, ensure_ascii=False)) > MAX_CONTEXT_BYTES:
            raise ValueError("context too large: send a short summary instead of raw data")
        return v


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    session_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    context: Optional[LunaContext] = None

    @field_validator("message")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message is empty")
        return v


class ChatResponse(BaseModel):
    reply: str
    session_id: str
    model: str
    # "available": the client can fetch Luna's spoken reply from POST /api/luna/tts (Kokoro).
    audio: Literal["available", "not_available"] = "not_available"


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1500)


class TTSPrewarmRequest(BaseModel):
    """Common phrases the app will probably say soon (synthesised in the background, cached on disk)."""

    texts: list[str] = Field(max_length=80)


class ErrorResponse(BaseModel):
    error: str  # stable machine-readable kind
    message: str  # human-readable, safe to show
