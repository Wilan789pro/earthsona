# EARTHSONA backend (Luna: Gemini chat + Kokoro voice) as a container, e.g. for a free Hugging Face Docker Space.
# Build context = this backend/ folder. Secrets are NOT baked in: set GEMINI_API_KEY in the host's secret settings.
FROM python:3.11-slim

RUN useradd -m -u 1000 user
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=user . .
# Kokoro-82M model + voices (about 120 MB, Apache-2.0) are downloaded at build time, never committed.
RUN python download_kokoro.py && mkdir -p cache && chown -R user /app

USER user
ENV PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
