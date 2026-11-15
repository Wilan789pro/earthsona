# Deploying EARTHSONA publicly (free tiers)

Nothing in this folder deploys anything by itself. It is the plan and the configuration. The steps marked **(you)** need
your accounts and must be done by a team member. No paid service is needed.

## Architecture

| Part | What | Where (free) | Secrets |
|---|---|---|---|
| Frontend | static site from `npm run build` (`dist/`, about 42 MB incl. the optimised NASA videos and the intro film) | **GitHub Pages** (public repo, free) | none: the frontend never holds a key |
| Backend (Luna) | FastAPI: Gemini chat + Kokoro-82M voice (`backend/`) | **Hugging Face Space, Docker, "CPU basic"** (free: 2 vCPU, 16 GB RAM; sleeps when unused) | `GEMINI_API_KEY` as a **Space secret** |

The app also works **without** the backend: the tour, missions, data sound, graph, lab and videos all run in the
browser; only Luna's chat and her Kokoro voice need the server (she falls back to the device's voice).

### Why these
- **GitHub Pages:** free for public repos, static, HTTPS, no account beyond GitHub. Files must stay under 100 MB; ours are at most 14 MB each.
- **Hugging Face Spaces (Docker):** free CPU hardware with enough RAM for Kokoro (≈1 GB), secrets support, public URL. It wakes up on the first visit after sleeping (about a minute).
- **Not chosen:** Cloudflare Pages (25 MB per-file limit is fine but needs another account), Render free (512 MB RAM is too small for Kokoro), Cloud Run (needs a billing account).

## Security checklist
- The Gemini key is only ever an environment variable on the backend host (`GEMINI_API_KEY`). It is in `.gitignore`d `backend/.env` locally; `backend/.dockerignore` keeps `.env` out of the container image.
- **CORS:** set `CORS_ORIGINS` to the exact Pages URL, e.g. `https://wilan789pro.github.io`.
- **Abuse limits:**
  - per-IP limit `LUNA_RATE_LIMIT_PER_MINUTE` (default 20);
  - whole-server cap `LUNA_DAILY_CHAT_LIMIT` per UTC day (default 500), so the key's free quota can't be exhausted.
- **Google AI Studio (you):** restrict the API key to the "Generative Language API".
- **Billing (you):** if billing is ever enabled, set a budget alert. On the free tier there is no charge; requests just fail when the quota is used up, and Luna explains that politely.
- **Privacy:** no user accounts, no cookies, no analytics. Chat messages are sent to the backend and to Gemini; they are not stored or logged (only lengths and timings are logged).

## Steps

### 1. Backend on Hugging Face (you, about 10 minutes)
1. Create a free account at https://huggingface.co and a **New Space**: SDK **Docker**, template **Blank**, hardware **CPU basic (free)**, visibility **Public**.
2. In the Space's **Settings → Variables and secrets**:
   - **Secret** `GEMINI_API_KEY` = your key (paste it there only; never in chat, code or GitHub);
   - **Variable** `GEMINI_MODEL` = `gemini-3.5-flash`;
   - **Variable** `CORS_ORIGINS` = `https://wilan789pro.github.io`;
   - *(optional)* `LUNA_DAILY_CHAT_LIMIT` = `500`.
3. Upload the **contents of `backend/`** to the Space's repository. Do **not** upload `.env`, `.venv/`, `models/` or `cache/`. You can use the web "Files → Add file → Upload files", or git:
   ```
   git clone https://huggingface.co/spaces/<you>/<space-name>
   copy backend\* into the clone (except .env, .venv, models, cache)
   ```
   Then add `deploy/huggingface-space-README.md` as the Space's `README.md`. It contains the `sdk: docker` / `app_port: 7860` header.
4. The Space builds the Dockerfile, which downloads Kokoro, and starts. Check `https://<you>-<space-name>.hf.space/api/health`: it should say `"gemini_key_configured": true, "tts_available": true`.

### 2. Frontend on GitHub Pages (you, about 5 minutes)
1. GitHub repo **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable**: `EARTHSONA_API_BASE` = `https://<you>-<space-name>.hf.space`. This is a public URL, not a secret.
3. **Actions → "Deploy frontend to GitHub Pages" → Run workflow** (`.github/workflows/pages.yml`). It installs, runs the unit tests, builds with that API base, and publishes.
4. Open `https://wilan789pro.github.io/earthsona/`. The first chat may take about a minute if the Space was asleep.

### 3. Check
- Ask Luna a question; press play in each mission; open the NASA videos; run the tour (❓).
- Without the backend, the app still works (Luna then says her AI server is offline).

## Known limits
- The free Space sleeps after a period without visits; the first request wakes it.
- Kokoro on a free CPU speaks new sentences after about 3–5 s; common lines are pre-generated and cached.
- The container build was not tested locally (Docker isn't installed on the development machine). The same code runs locally with Python 3.13.
