"""EARTHSONA backend: Luna's chat endpoint (Gemini). Run from the backend folder:

    .venv\\Scripts\\python.exe -m uvicorn main:app --port 8000 --reload

Endpoints
    GET  /api/health      is the backend up, which model, is a key configured (never the key itself)
    POST /api/luna/chat   {message, session_id, context?} -> {reply, session_id, model, audio}
    POST /api/luna/tts    {text} -> audio/wav spoken by Kokoro-82M (voice af_heart)
    POST /api/luna/tts/prewarm {texts} -> queue common phrases for background synthesis (disk-cached)
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict, deque

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from config.settings import settings
from schemas.luna import ChatRequest, ChatResponse, ErrorResponse, TTSPrewarmRequest, TTSRequest
from services.gemini_service import GeminiError, GeminiService
from services.luna_service import LunaService
from services.tts_service import TTSError, TTSService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("earthsona")
# Keep third-party request logs quiet (they would list every Gemini call).
for _name in ("httpx", "google_genai"):
    logging.getLogger(_name).setLevel(logging.WARNING)

app = FastAPI(title="EARTHSONA backend", version="0.1.0", docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

gemini = GeminiService(settings)
luna = LunaService(settings, gemini)
tts = TTSService()

# Per-IP sliding window rate limit (in memory; enough for a single dev/demo server).
_hits: dict[str, deque[float]] = defaultdict(deque)


def _rate_limited(ip: str, kind: str = "chat") -> bool:
    now = time.time()
    q = _hits[f"{kind}:{ip}"]
    while q and now - q[0] > 60:
        q.popleft()
    # Speech is requested for every line Luna says, so it gets a higher allowance than chat.
    if len(q) >= settings.rate_limit_per_minute * (4 if kind == "tts" else 1):
        return True
    q.append(now)
    return False


@app.on_event("startup")
async def _startup() -> None:
    log.info("Luna backend: model=%s, key %s, CORS=%s", settings.gemini_model, settings.masked_key(), ",".join(settings.cors_origins))
    if tts.files_present:
        # Load Kokoro in the background so the first spoken line doesn't wait for the model.
        async def _warm() -> None:
            try:
                await asyncio.to_thread(tts._load)
            except Exception:  # noqa: BLE001 - reported by /api/health
                pass

        asyncio.create_task(_warm())
    else:
        log.warning("Kokoro model files not found in backend/models; run download_kokoro.py. Luna will use the browser voice.")
    if not settings.has_key:
        log.warning("GEMINI_API_KEY is not set. Create backend/.env (see backend/.env.example). /api/luna/chat will return 503.")


@app.exception_handler(GeminiError)
async def _gemini_error(_: Request, exc: GeminiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=ErrorResponse(error=exc.kind, message=exc.message).model_dump())


@app.exception_handler(TTSError)
async def _tts_error(_: Request, exc: TTSError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=ErrorResponse(error=exc.kind, message=exc.message).model_dump())


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "model": settings.gemini_model, "gemini_key_configured": settings.has_key, "tts_available": tts.available()}


@app.post("/api/luna/tts", responses={200: {"content": {"audio/wav": {}}}, 503: {"model": ErrorResponse}})
async def luna_tts(req: TTSRequest, request: Request) -> Response:
    ip = request.client.host if request.client else "unknown"
    if _rate_limited(ip, kind="tts"):
        return JSONResponse(status_code=429, content=ErrorResponse(error="rate_limited", message="Too many voice requests. Please wait a minute.").model_dump())
    started = time.perf_counter()
    audio = await tts.speak(req.text.strip(), gone=request.is_disconnected)
    log.info("tts %d chars %.2fs", len(req.text), time.perf_counter() - started)  # length only, never the text
    return Response(content=audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.post("/api/luna/tts/prewarm")
async def luna_tts_prewarm(req: TTSPrewarmRequest, request: Request) -> JSONResponse:
    ip = request.client.host if request.client else "unknown"
    if _rate_limited(ip, kind="prewarm"):
        return JSONResponse(status_code=429, content=ErrorResponse(error="rate_limited", message="Too many requests.").model_dump())
    if not tts.available():
        return JSONResponse(status_code=503, content=ErrorResponse(error="tts_not_installed", message="Luna's voice is not available.").model_dump())
    return JSONResponse({"queued": tts.prewarm(req.texts), "stats": tts.stats})


@app.post("/api/luna/chat", response_model=ChatResponse, responses={429: {"model": ErrorResponse}, 502: {"model": ErrorResponse}, 503: {"model": ErrorResponse}, 504: {"model": ErrorResponse}})
async def luna_chat(req: ChatRequest, request: Request) -> ChatResponse | JSONResponse:
    ip = request.client.host if request.client else "unknown"
    if _rate_limited(ip):
        return JSONResponse(status_code=429, content=ErrorResponse(error="rate_limited", message="Too many messages. Please wait a minute.").model_dump())
    started = time.perf_counter()
    reply = await luna.chat(req.session_id, req.message, req.context)
    log.info("luna chat ok session=%s... %.1fs", req.session_id[:6], time.perf_counter() - started)  # no message content logged
    return ChatResponse(reply=reply, session_id=req.session_id, model=settings.gemini_model, audio="available" if tts.available() else "not_available")
