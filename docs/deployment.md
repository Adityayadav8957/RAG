# Deployment and operations

Keys, configuration, deploying to Render + Neon, operating the service and troubleshooting.
The project overview and engineering notes are in the [README](../README.md).

## Keys and accounts you need

Everything below has a free tier. **Local development needs only the first two rows.**

| # | What | Where to get it | Env var | Needed for |
|---|---|---|---|---|
| 1 | Gemini API key | [Google AI Studio](https://aistudio.google.com/apikey) | `GEMINI_API_KEY` | Local + prod |
| 2 | Google OAuth client ID (Web) | Google Cloud Console → APIs & Services → Credentials → OAuth client ID → *Web application*. Add `http://localhost:3000` (and later your production URL) under **Authorized JavaScript origins**. No redirect URI is needed. | `GOOGLE_CLIENT_ID` (backend) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (frontend, same value) | Local + prod |
| 3 | Session secret | `openssl rand -hex 32` | `SESSION_SECRET` | Prod |
| 4 | Token encryption key | `python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"` (any random string of 16+ characters also works) | `TOKEN_ENCRYPTION_KEY` | Prod (encrypts Jira tokens at rest) |
| 5 | MCP shared secret | `openssl rand -hex 32` | `MCP_SHARED_SECRET` (identical on the API and the MCP service) | Prod |
| 6 | Neon Postgres URL | [neon.tech](https://neon.tech) → create project → **pooled** connection string | `DATABASE_URL` | Prod |
| 8 | Jira OAuth app | [developer.atlassian.com](https://developer.atlassian.com/console/myapps/) → create **OAuth 2.0 (3LO)** app → Permissions: Jira API with `read:jira-work`, `write:jira-work` and `manage:jira-project` (needed to create projects) → Authorization: callback URL `https://<your-api>/v1/integrations/jira/callback` | `JIRA_OAUTH_CLIENT_ID`, `JIRA_OAUTH_CLIENT_SECRET` | Only if you want Jira |
| 9 | Sign-up mode (optional admin emails) | `open` (self-serve, the default) or `restricted` | `SIGNUP_MODE`, `ADMIN_EMAILS`, `ALLOWED_EMAIL_DOMAINS` | Prod |
| 10 | Render account | [render.com](https://render.com) | (deploy target) | Prod |
| 11 | Metrics token (optional) | `openssl rand -hex 32` | `METRICS_TOKEN` | Optional |
| 11b | Fallback model key (optional) | [console.groq.com](https://console.groq.com) (free), or another OpenAI-compatible provider | `FALLBACK_API_KEY` and the `FALLBACK_*` settings | Optional, recommended on free tiers |
| 12 | Cloudflare (optional) | Put your domain behind Cloudflare for WAF and rate limiting | none | Optional |

**Model availability:** Google retires models for new keys. The defaults are `gemini-3.5-flash-lite` (small) and `gemini-3.5-flash` (frontier); check the list for your key if you see a 404 "no longer available" error.

**Gemini free tier:** rate limits are low and Google may use free-tier prompts to improve its
products. Use it for development. For real employee data, switch to a paid key or another
provider by implementing `LLMClient` (`backend/app/llm/client.py`).

## Run it locally

Prerequisites: Docker, Python 3.11+ (3.12 recommended), Node 22.

```bash
# 1. Postgres with pgvector (port 5433)
docker compose up -d postgres

# 2. Backend
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env            # then set GEMINI_API_KEY and GOOGLE_CLIENT_ID,
                                # ALLOWED_EMAIL_DOMAINS and ADMIN_EMAILS
alembic upgrade head
uvicorn --factory app.main:create_app --reload --port 8000

# 3. Jira MCP server (optional, only for Jira tools), in another terminal
cd backend && source .venv/bin/activate
uvicorn jira_mcp.server:app --port 8100

# 4. Frontend, in another terminal
cd frontend
cp .env.example .env.local      # set NEXT_PUBLIC_GOOGLE_CLIENT_ID, BACKEND_URL=http://localhost:8000,
                                # SESSION_COOKIE_SECURE=false
npm install
npm run dev
```

Open http://localhost:3000 and sign in with a Google account on your allowed domain. The
first login of an address listed in `ADMIN_EMAILS` becomes an admin. Admins can grant the
`hr` or `manager` roles in **Admin**, which allows uploading documents.

Interactive API docs are at http://localhost:8000/docs when `ENVIRONMENT` is not production.

**Everything in Docker:** put the variables in `backend/.env` and run `docker compose up --build`.

> On macOS another Postgres may already use port 5432, so the compose file maps ours to 5433.

## Configuration reference

All settings are environment variables (see `backend/.env.example` and `backend/app/config.py`).
With `ENVIRONMENT` set to `staging` or `production` the app **refuses to start** unless the
required secrets are set.

| Variable | Default | Purpose |
|---|---|---|
| `ENVIRONMENT` | `local` | `local`, `staging`, `production` |
| `PUBLIC_BASE_URL` | `http://localhost:8000` | Public URL of the API (Jira OAuth callback) |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | Where users are redirected after Jira connect; CORS origin |
| `DATABASE_URL` | local compose | Postgres. Neon `postgresql://…?sslmode=require` URLs work as given |
| `GOOGLE_CLIENT_ID` | — | Audience for Google ID token verification |
| `SIGNUP_MODE` | `open` | `open`: anyone can sign up (see *Getting people in*). `restricted`: only `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS` and invited emails |
| `ALLOWED_EMAIL_DOMAINS` | — | Comma-separated; used by `restricted` mode |
| `ADMIN_EMAILS` | — | Comma-separated; become admins on sign-in |
| `SESSION_SECRET`, `SESSION_TTL_MINUTES` | —, `480` | Signing key and lifetime of app sessions |
| `TOKEN_ENCRYPTION_KEY` | — | Fernet key for tokens stored in the database |
| `GEMINI_API_KEY` | — | Gemini |
| `MODEL_SMALL`, `MODEL_FRONTIER` | `gemini-3.5-flash-lite`, `gemini-3.5-flash` | Router targets |
| `FALLBACK_API_KEY`, `FALLBACK_BASE_URL`, `FALLBACK_MODEL_SMALL`, `FALLBACK_MODEL_FRONTIER` | unset, `https://api.x.ai/v1` | Optional second provider (any OpenAI-compatible API: Groq, xAI Grok, OpenRouter, Ollama). Used when Gemini fails (or first, with `LLM_PREFER_FALLBACK`). Example for Groq: base URL `https://api.groq.com/openai/v1`, models `openai/gpt-oss-20b` and `openai/gpt-oss-120b` |
| `LLM_PREFER_FALLBACK` | `false` | Answer with the fallback provider first (lower latency); Gemini becomes the fallback. Embeddings always use Gemini. |
| `EMBEDDING_MODEL`, `EMBEDDING_DIM` | `gemini-embedding-001`, `768` | Changing the dimension needs a migration and a reindex |
| `RETRIEVAL_TOP_K`, `RETRIEVAL_CANDIDATES` | `8`, `24` | Context size and candidate pool |
| `LLM_RERANK` | `true` | LLM reranking of candidates (one extra small-model call) |
| `CACHE_ENABLED`, `CACHE_SIMILARITY_THRESHOLD`, `CACHE_TTL_SECONDS` | `true`, `0.93`, `3600` | Semantic cache |
| `INJECTION_BLOCK_THRESHOLD`, `INJECTION_LLM_CHECK` | `0.8`, `true` | Prompt-injection controls |
| `PII_INPUT_MODE`, `PII_OUTPUT_MODE` | `mask` | `mask`, `block` or `off` |
| `STRICT_GROUNDING` | `true` | Refuse company-knowledge answers that have no retrieved evidence |
| `POLICY_FILE` | `config/policy.yaml` | Tool permissions and blocked patterns |
| `DAILY_REQUEST_QUOTA`, `BURST_REQUESTS_PER_MINUTE` | `300`, `20` | Per-user limits |
| `MAX_AGENT_STEPS`, `MAX_INPUT_CHARS`, `MAX_UPLOAD_MB` | `6`, `8000`, `10` | Safety limits |
| `JIRA_MCP_URL` | `http://localhost:8100/mcp` | Location of the Jira MCP server |
| `MCP_SHARED_SECRET` | — | Gateway ↔ MCP shared secret |
| `JIRA_OAUTH_CLIENT_ID`, `JIRA_OAUTH_CLIENT_SECRET` | — | Atlassian OAuth app |
| `APPROVAL_TTL_MINUTES` | `15` | How long an action can wait for approval |
| `METRICS_TOKEN` | — | If set, `/metrics` requires `Authorization: Bearer <token>` |

### Tool policy

`backend/config/policy.yaml` is the single place that says which tools exist, who may use
them and which need approval. A tool that is not listed cannot be called, even if the MCP
server offers it. Any tool with `access: write` requires approval unless you explicitly set
`approval: false`.

## Deploy: Render + Neon

Three Render web services (API, Jira MCP server, web app) described in `render.yaml`.

1. **Neon**: create a project and copy the **pooled** connection string. The app handles
   `sslmode`, PgBouncer and idle suspend (connections are recycled) automatically.
2. **Google OAuth**: create the Web client (table above). Add your final web URL, for example
   `https://assistant-web.onrender.com`, to **Authorized JavaScript origins**.
3. **Atlassian** (optional): create the 3LO app. Set the callback to
   `https://<api-service>.onrender.com/v1/integrations/jira/callback`.
4. **Render**: *New → Blueprint*, select this repository. Fill in the variables marked
   `sync: false` (see the table of keys). Set the same `MCP_SHARED_SECRET` on the API and the
   MCP service. Set `JIRA_MCP_URL` to `https://<mcp-service>.onrender.com/mcp`, and
   `PUBLIC_BASE_URL` / `FRONTEND_ORIGIN` / `BACKEND_URL` to the services' public URLs.
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is read at **build time**; set it before the first deploy.
5. **First start**: the Blueprint sets `RUN_MIGRATIONS=false` to keep cold starts fast, so run
   `alembic upgrade head` once against Neon yourself (or temporarily set `RUN_MIGRATIONS=true`), and again
   after any schema change. Migrations also enable the `vector` extension. Check `https://<api>/readyz`.
6. **Sign in** with an address listed in `ADMIN_EMAILS`, then invite colleagues in **Admin**
   (see *Getting people in*). For an interview demo nothing needs preparing: the interviewer signs
   in with any Google account, gets their own workspace as admin, uploads a document and chats.

**Cloudflare (optional, recommended):** proxy your custom domain through Cloudflare and add
a rate-limiting rule for `/v1/*` (this is the "Edge" box in the architecture) and the managed
WAF ruleset. The in-app limits are per user; Cloudflare limits per IP.

**Free tier behaviour:** Render free services sleep after about 15 minutes idle, so the first
request after a pause takes around half a minute. Neon also scales to zero. Both are
handled correctly but are noticeable. Paid instances remove the cold start.

**Scaling beyond one instance:** migrations on boot are safe for one instance. With several,
set `RUN_MIGRATIONS=false` and run `alembic upgrade head` as a deploy step. The per-minute burst
limiter is in-process; the durable daily quota is in Postgres.

## Latency and live end-to-end checks

`backend/evals/e2e_live.py` talks to a **running** API with real models and real documents. It asks
ten questions over SSE, checks each answer for the expected facts, checks that an unknown fact is
refused and an injection is blocked, repeats a question to confirm the cache, and prints latency per
request and per pipeline stage:

```bash
cd backend && .venv/bin/python -m evals.e2e_live --email you@vcbay.co   # upload the sample PDF first
```

What decides latency, measured with the sample policy PDF:

| Factor | Effect | What the app does |
|---|---|---|
| Distance to Postgres | A request makes ~10 DB round trips. At ~150 ms each (laptop to Neon Singapore) that is ~2-3 s. | In production, run Render in the same region as Neon (Singapore). Locally, use the Docker Postgres for a fast loop. |
| Model provider | Gemini's free tier takes 1-6 s per call and returns 503 under load. Groq takes 0.3-1 s. | `LLM_PREFER_FALLBACK=true` answers with the OpenAI-compatible provider first and uses Gemini as the fallback. Gemini runs with `thinking_level=low`. |
| Overlap | The cache embedding and the intent call are independent. | They run concurrently. Vector and keyword search also run concurrently. |
| Wasted calls | A second search or a rerank adds an LLM round trip. | A knowledge question gets its excerpts up front and is answered without a tool round trip. Reranking runs only when there are more candidates than are kept. An empty search answers immediately. |

Typical results (local Postgres, Groq first): cache hit about 1 s, uncached grounded answer 1.5-3 s,
injection refused in under 0.2 s. Against Neon from a laptop, add the DB round trips.

## Operations

- **Logs**: JSON lines with `request_id` and `user_id`. Every response carries `X-Request-ID`.
- **Metrics**: Prometheus at `/metrics` (requests, latency, cache results, LLM calls,
  guardrail activations, tool outcomes, step latency). Protect with `METRICS_TOKEN`.
- **Health**: `/healthz` (process), `/readyz` (Postgres and pgvector).
- **Audit**: query `GET /v1/admin/audit` or the `audit_log` table. Events include
  `auth.login`, `chat.input_blocked`, `chat.answered`, `chat.output_guardrail`,
  `document.*`, `tool.approval_requested`, `tool.approved`, `tool.rejected`,
  `tool.executed`, `tool.denied`, `retrieval.injection_dropped`, `retrieval.acl_mismatch`,
  `admin.*`. `retrieval.acl_mismatch` should never appear; investigate if it does.
- **Rotating secrets**: changing `SESSION_SECRET` signs everyone out. Changing
  `TOKEN_ENCRYPTION_KEY` makes stored Jira tokens unreadable, so users reconnect Jira.
- **Changing the embedding model or dimension**: write a migration that changes the `vector(768)`
  columns, then run `python -m app.rag.reindex` to re-embed every chunk.
- **Backups**: Neon provides point-in-time restore. Vectors live in Postgres with everything else.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| API exits with "Invalid production configuration" | A required secret is missing; the message lists which |
| Sign-in says "Invalid Google credential" | `GOOGLE_CLIENT_ID` differs from the one the frontend uses, or your origin isn't an Authorized JavaScript origin |
| Sign-in says the domain is not allowed | `ALLOWED_EMAIL_DOMAINS` doesn't include the account's domain |
| Cannot upload documents | Your user needs the `hr`, `manager` or `admin` role |
| Documents stay "processing" | Check API logs for `ingest_failed`; usually the Gemini key or rate limit |
| "The assistant is temporarily unavailable" | Gemini rate limit (free tier) or a bad key; the router already falls back to the small model |
| Jira tools say to connect Jira | Connect from Settings; check the callback URL matches exactly |
| `/readyz` returns 503 | `postgres` or `pgvector` shows `error`; check `DATABASE_URL`, and that migrations ran |
| Slow first request on Render | Free instance waking from sleep |
