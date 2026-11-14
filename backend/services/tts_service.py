"""Luna's voice: Kokoro-82M text-to-speech (ONNX build via `kokoro-onnx`), voice `af_heart` by default.

Kept separate from Gemini so either can be replaced. The model files live in backend/models (git-ignored);
download them with `python download_kokoro.py`. Synthesis runs in a worker thread and recent results are
cached, so replaying a line is instant.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import threading
import wave
from collections import OrderedDict
from pathlib import Path

from config.settings import BACKEND_DIR

log = logging.getLogger("earthsona.tts")

MODEL_DIR = BACKEND_DIR / "models"
MODEL_FILE = MODEL_DIR / os.getenv("KOKORO_MODEL_FILE", "kokoro-v1.0.int8.onnx")
VOICES_FILE = MODEL_DIR / os.getenv("KOKORO_VOICES_FILE", "voices-v1.0.bin")
VOICE = os.getenv("KOKORO_VOICE", "af_heart")
SPEED = float(os.getenv("KOKORO_SPEED", "1.0"))


class TTSError(Exception):
    def __init__(self, kind: str, message: str, status_code: int):
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.status_code = status_code


class TTSService:
    def __init__(self) -> None:
        self._kokoro = None
        self._lock = threading.Lock()
        self._cache: "OrderedDict[str, bytes]" = OrderedDict()
        self.error: str | None = None

    @property
    def files_present(self) -> bool:
        return MODEL_FILE.exists() and VOICES_FILE.exists()

    def available(self) -> bool:
        return self.files_present and self.error is None

    def _load(self):
        if self._kokoro is not None:
            return self._kokoro
        if not self.files_present:
            raise TTSError("tts_not_installed", "Luna's voice model is not installed (run download_kokoro.py in backend/).", 503)
        try:
            from kokoro_onnx import Kokoro

            self._kokoro = Kokoro(str(MODEL_FILE), str(VOICES_FILE))
            log.info("Kokoro loaded (%s, voice %s)", MODEL_FILE.name, VOICE)
        except Exception as exc:  # noqa: BLE001
            self.error = str(exc)
            log.exception("Could not load Kokoro")
            raise TTSError("tts_failed", "Luna's voice could not start on the server.", 503) from exc
        return self._kokoro

    def _synth(self, text: str) -> bytes:
        with self._lock:  # one synthesis at a time keeps CPU use predictable
            kokoro = self._load()
            samples, rate = kokoro.create(text, voice=VOICE, speed=SPEED, lang="en-us")
        import numpy as np

        pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(int(rate))
            w.writeframes(pcm)
        return buf.getvalue()

    async def speak(self, text: str) -> bytes:
        if text in self._cache:
            self._cache.move_to_end(text)
            return self._cache[text]
        try:
            audio = await asyncio.wait_for(asyncio.to_thread(self._synth, text), timeout=60)
        except TTSError:
            raise
        except asyncio.TimeoutError as exc:
            raise TTSError("tts_timeout", "Generating Luna's voice took too long.", 504) from exc
        except Exception as exc:  # noqa: BLE001
            log.exception("Kokoro synthesis failed")
            raise TTSError("tts_failed", "Luna's voice could not be generated for this text.", 500) from exc
        self._cache[text] = audio
        while len(self._cache) > 40:
            self._cache.popitem(last=False)
        return audio
