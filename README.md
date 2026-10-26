# Enterprise AI Assistant

A secure internal AI assistant for employees. It answers questions from company documents
(RAG) with per-document access control, and can act in Jira on the user's behalf, with
human approval for anything that changes data.

- **Chat** with streaming answers and source citations
- **RAG** over uploaded PDF, DOCX, TXT and Markdown, with document-level ACLs
- **Jira tools** over MCP, using each employee's own Jira permissions
- **Guardrails**: prompt-injection detection, PII and secret masking, DLP on output, policy rules
- **Agent activity panel**: a live view of every step the agent takes (guardrails, intent, cache, model routing, retrieval, tool calls, approvals, validation) with timings, replayable for any past answer
- **Audit trail**, metrics, tracing, evaluation suite and a CI release gate

```
Browser ─▶ Next.js (BFF, httpOnly cookie) ─▶ FastAPI ─▶ Gemini
                                              │  ├─▶ Postgres (Neon): users, ACLs, chunks, audit
                                              │  ├─▶ Qdrant Cloud: vectors + semantic cache
                                              │  └─▶ Jira MCP server ─▶ Jira (as the user)
```

The full request flow is in [docs/architecture.md](docs/architecture.md).

## Contents

1. [Repository layout](#repository-layout)
2. [Keys and accounts you need](#keys-and-accounts-you-need)
3. [Run it locally](#run-it-locally)
4. [Configuration reference](#configuration-reference)
5. [Deploy: Render + Neon + Qdrant Cloud](#deploy-render--neon--qdrant-cloud)
6. [Using the app](#using-the-app)
7. [Security model](#security-model)
8. [Testing and the release gate](#testing-and-the-release-gate)
9. [Operations](#operations)
10. [API overview](#api-overview)
11. [Known limitations](#known-limitations)
12. [Troubleshooting](#troubleshooting)

## Repository layout

```
backend/                 FastAPI service (Python 3.12)
  app/
    api/                 HTTP routes: auth, chat (SSE), documents, integrations, admin
    agent/               orchestrator, intent + model router, policy, guardrails,
                         tool gateway, MCP client, Jira OAuth
    rag/                 parsing, chunking, ingestion, hybrid retrieval, Qdrant access
    cache/               permission-aware semantic cache
    security/            Google token verification, sessions, RBAC, PII, injection, crypto
    observability/       audit log, Prometheus metrics, tracing spans
    db/                  SQLAlchemy models and async session (Neon-aware)
    llm/                 provider-neutral LLM interface + Gemini client
  jira_mcp/              Jira MCP server (streamable HTTP, stateless)
  alembic/               database migrations
  config/policy.yaml     tool permissions, blocked requests, blocked output
  evals/                 behavioural regression suite and release gate
  tests/                 unit tests and integration tests (real Postgres + Qdrant)
frontend/                Next.js app (chat, documents, settings, admin)
docs/                    architecture
docker-compose.yml       local Postgres + Qdrant (and the full stack)
render.yaml              Render Blueprint
.github/workflows/       CI
```

## Keys and accounts you need

Everything below has a free tier. **Local development needs only the first two rows.**

| # | What | Where to get it | Env var | Needed for |
|---|---|---|---|---|
| 1 | Gemini API key | [Google AI Studio](https://aistudio.google.com/apikey) | `GEMINI_API_KEY` | Local + prod |
| 2 | Google OAuth client ID (Web) | Google Cloud Console → APIs & Services → Credentials → OAuth client ID → *Web application*. Add `http://localhost:3000` (and later your production URL) under **Authorized JavaScript origins**. No redirect URI is needed. | `GOOGLE_CLIENT_ID` (backend) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (frontend, same value) | Local + prod |
| 3 | Session secret | `openssl rand -hex 32` | `SESSION_SECRET` | Prod |
| 4 | Token encryption key | `python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"` | `TOKEN_ENCRYPTION_KEY` | Prod (encrypts Jira tokens at rest) |
| 5 | MCP shared secret | `openssl rand -hex 32` | `MCP_SHARED_SECRET` (identical on the API and the MCP service) | Prod |
| 6 | Neon Postgres URL | [neon.tech](https://neon.tech) → create project → **pooled** connection string | `DATABASE_URL` | Prod |
| 7 | Qdrant Cloud URL + API key | [cloud.qdrant.io](https://cloud.qdrant.io) → free cluster → API key | `QDRANT_URL`, `QDRANT_API_KEY` | Prod |
| 8 | Jira OAuth app | [developer.atlassian.com](https://developer.atlassian.com/console/myapps/) → create **OAuth 2.0 (3LO)** app → Permissions: Jira API with `read:jira-work` and `write:jira-work` → Authorization: callback URL `https://<your-api>/v1/integrations/jira/callback` | `JIRA_OAUTH_CLIENT_ID`, `JIRA_OAUTH_CLIENT_SECRET` | Only if you want Jira |
| 9 | Allowed email domain(s) and admin emails | Your Workspace domain, and who should be admin | `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS` | Prod |
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
# 1. Postgres (port 5433) and Qdrant (port 6333)
docker compose up -d postgres qdrant

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
| `QDRANT_URL`, `QDRANT_API_KEY` | local | Qdrant |
| `GOOGLE_CLIENT_ID` | — | Audience for Google ID token verification |
| `ALLOWED_EMAIL_DOMAINS` | — | Comma-separated; only these domains can sign in |
| `ADMIN_EMAILS` | — | Comma-separated; become admins on sign-in |
| `BOOTSTRAP_FIRST_ADMIN` | `false` | While no admin exists, the first allowed person to sign in becomes admin |
| `SESSION_SECRET`, `SESSION_TTL_MINUTES` | —, `480` | Signing key and lifetime of app sessions |
| `TOKEN_ENCRYPTION_KEY` | — | Fernet key for tokens stored in the database |
| `GEMINI_API_KEY` | — | Gemini |
| `MODEL_SMALL`, `MODEL_FRONTIER` | `gemini-3.5-flash-lite`, `gemini-3.5-flash` | Router targets |
| `FALLBACK_API_KEY`, `FALLBACK_BASE_URL`, `FALLBACK_MODEL_SMALL`, `FALLBACK_MODEL_FRONTIER` | unset, `https://api.x.ai/v1` | Optional second provider (any OpenAI-compatible API: Groq, xAI Grok, OpenRouter, Ollama). Used when Gemini fails (or first, with `LLM_PREFER_FALLBACK`). Example for Groq: base URL `https://api.groq.com/openai/v1`, models `openai/gpt-oss-20b` and `openai/gpt-oss-120b` |
| `LLM_PREFER_FALLBACK` | `false` | Answer with the fallback provider first (lower latency); Gemini becomes the fallback. Embeddings always use Gemini. |
| `SINGLE_TENANT` | empty | Put every allowed email domain in one tenant. Default: tenant = email domain, so a user at `a.com` cannot read `b.com` documents. |
| `EMBEDDING_MODEL`, `EMBEDDING_DIM` | `gemini-embedding-001`, `768` | Changing the dimension needs new Qdrant collections |
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

## Deploy: Render + Neon + Qdrant Cloud

Three Render web services (API, Jira MCP server, web app) described in `render.yaml`.

1. **Neon**: create a project and copy the **pooled** connection string. The app handles
   `sslmode`, PgBouncer and idle suspend (connections are recycled) automatically.
2. **Qdrant Cloud**: create a free cluster; copy the URL and an API key.
3. **Google OAuth**: create the Web client (table above). Add your final web URL, for example
   `https://assistant-web.onrender.com`, to **Authorized JavaScript origins**.
4. **Atlassian** (optional): create the 3LO app. Set the callback to
   `https://<api-service>.onrender.com/v1/integrations/jira/callback`.
5. **Render**: *New → Blueprint*, select this repository. Fill in the variables marked
   `sync: false` (see the table of keys). Set the same `MCP_SHARED_SECRET` on the API and the
   MCP service. Set `JIRA_MCP_URL` to `https://<mcp-service>.onrender.com/mcp`, and
   `PUBLIC_BASE_URL` / `FRONTEND_ORIGIN` / `BACKEND_URL` to the services' public URLs.
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is read at **build time**; set it before the first deploy.
6. **First start**: the API runs `alembic upgrade head` on boot (`RUN_MIGRATIONS=true`) and
   creates the Qdrant collections. Check `https://<api>/readyz`.
7. **Sign in** with an address listed in `ADMIN_EMAILS`, then invite colleagues in **Admin**
   (see *Getting people in*). For an interview demo, invite the interviewer's Google address as
   `admin` before the session, or enable `BOOTSTRAP_FIRST_ADMIN` on a fresh database.

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

## Agent activity panel

Every chat request produces a structured trace that the UI renders as a live pipeline:

```
Input guardrails → Intent → Cache → Router → Retrieve / Tools → Validate → Output guardrails
```

Each step reports its status, duration and a human-readable summary: which checks ran, what
the intent classifier decided, whether the cache hit, which model the router chose and why,
which documents were retrieved (titles only), which tool ran and as whom, whether a human
approval is pending, and whether the answer was masked or withheld. When Gemini fails and the
fallback model answers, the step is labelled as such. The trace is sent as `trace` events on the
chat stream and stored with the answer (`GET /v1/conversations/{id}/messages` returns it), so
past answers can be replayed. It never contains document text or secrets. Code:
`backend/app/observability/trace_events.py` and the orchestrator.

## Using the app

| Page | Who | What it does |
|---|---|---|
| Chat | everyone | Ask questions; answers cite sources as `[1]`. Jira requests that change data show an approval card |
| Documents | everyone sees what they may read; `hr`, `manager`, `admin` upload | Upload PDF/DOCX/TXT/MD, set visibility (everyone, or specific roles and people), change access, delete |
| Settings | everyone | Connect or disconnect Jira, sign out |
| Admin | `admin` | Manage roles, deactivate users, read the audit log |

### Getting people in: admin setup and inviting teammates

Everyone signs in with Google. There is no password and no separate signup form.

1. **First admin.** Put your email in `ADMIN_EMAILS`. When that address first signs in, the account
   is created with the `admin` role. For a throwaway demo you can instead set
   `BOOTSTRAP_FIRST_ADMIN=true`: while no admin exists, the first allowed person to sign in becomes
   admin. Turn it off afterwards.
2. **Who may sign in.** An email is admitted if its domain is in `ALLOWED_EMAIL_DOMAINS`, it is in
   `ADMIN_EMAILS`, or an admin invited it.
3. **Invite a teammate** (Admin page, "Invite a teammate"): enter their email and roles. No email is
   sent; share the app link. When they sign in with Google using that email they land with exactly
   those roles. Re-inviting changes the roles, and revoking an invitation blocks sign-in.
4. **Manage them later** in the same page: change roles, deactivate an account (effective on the very
   next request), and read the audit log (`admin.user_invited`, `admin.roles_changed`, ...).

API: `GET/POST /v1/admin/invitations`, `DELETE /v1/admin/invitations/{id}`.

Roles: `employee` (default), `manager`, `hr`, `admin`. Document access is `all`, or
restricted to listed roles and individual users. The uploader and admins can always read.

## Security model

| Threat | Control |
|---|---|
| Unauthorized access | Google ID token verified server-side (audience, verified email, allowed domain, Workspace `hd`); roles re-read from the database on every request; deactivation takes effect immediately |
| Session theft by script | Session token is in an httpOnly cookie set by the Next.js server; browser JavaScript never sees it |
| Reading documents you shouldn't | ACL filter in Qdrant, SQL, and a final Python check; ACL changes sync to the vector payload and purge cached answers |
| Cache leaking across users | Every cache hit re-validates access to all source documents; tool-using answers are never cached |
| Prompt injection (user) | Heuristic score + optional LLM classifier on borderline input; fail closed |
| Indirect injection (documents, tool output) | Scan, drop above threshold, fence as untrusted data |
| Data exfiltration through output | DLP masks secrets, keys, cards, SSNs; markdown/HTML images removed; internal markers blocked |
| Unauthorized or unintended actions | Fail-closed tool policy, per-user OAuth token, human approval for writes, single-use expiring approvals |
| Replay of an approval | Atomic compare-and-set; a decided action cannot be decided again |
| Tampering with the audit trail | Database trigger rejects `UPDATE` and `DELETE` on `audit_log`; sensitive keys are redacted before writing |
| Stolen database | Third-party tokens are encrypted with a Fernet key held outside the database |
| Abusing the MCP server | Requires the shared secret; holds no Jira credentials itself |
| Cost abuse | Per-user burst and daily quotas, input length limit, agent step limit |

What the model sees is limited by design: it never receives documents the user cannot read.

## Testing and the release gate

```bash
cd backend
docker compose -f ../docker-compose.yml up -d postgres qdrant   # integration tests need these
pytest                       # 31 unit + 26 integration tests
ruff check . && ruff format --check . && mypy app jira_mcp
```

The integration tests run the real application against real Postgres and Qdrant with a
fake model, and assert security properties: ACL isolation, cache non-leakage, injection
blocking in input, documents and tool output, approval single-use and expiry, role
enforcement, audit immutability, and the real MCP server over HTTP. Tests are skipped
automatically if Postgres or Qdrant is unreachable.

**Evaluation suite** (`backend/evals/`): data-driven cases in `cases.yaml`, thresholds in
`thresholds.yaml`.

```bash
createdb assistant_eval && DATABASE_URL=.../assistant_eval alembic upgrade head
EVAL_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5433/assistant_eval \
  python -m evals.run --mode fake     # deterministic, used in CI
  python -m evals.run --mode live     # real Gemini, measures real answer quality
```

Security cases must pass 100%, quality cases 80%. The runner exits non-zero otherwise, and CI
(`.github/workflows/ci.yml`) uses that as the gate before images are built. It refuses to run
unless the database name contains `eval` or `test`, because it truncates tables.

Add a case to `cases.yaml` for every incident or bug you want to never see again.

## Operations

- **Logs**: JSON lines with `request_id` and `user_id`. Every response carries `X-Request-ID`.
- **Metrics**: Prometheus at `/metrics` (requests, latency, cache results, LLM calls,
  guardrail activations, tool outcomes, step latency). Protect with `METRICS_TOKEN`.
- **Health**: `/healthz` (process), `/readyz` (Postgres and Qdrant).
- **Audit**: query `GET /v1/admin/audit` or the `audit_log` table. Events include
  `auth.login`, `chat.input_blocked`, `chat.answered`, `chat.output_guardrail`,
  `document.*`, `tool.approval_requested`, `tool.approved`, `tool.rejected`,
  `tool.executed`, `tool.denied`, `retrieval.injection_dropped`, `retrieval.acl_mismatch`,
  `admin.*`. `retrieval.acl_mismatch` should never appear; investigate if it does.
- **Rotating secrets**: changing `SESSION_SECRET` signs everyone out. Changing
  `TOKEN_ENCRYPTION_KEY` makes stored Jira tokens unreadable, so users reconnect Jira.
- **Changing the embedding model or dimension**: create new Qdrant collections (new
  `QDRANT_CHUNKS_COLLECTION`), then re-upload documents.
- **Backups**: Neon provides point-in-time restore. Qdrant vectors can be rebuilt from
  Postgres chunks by re-embedding.

## API overview

All under `/v1`, Bearer-authenticated except `auth/google`. Chat endpoints stream
Server-Sent Events: `status`, `token`, `approval_required`, `final`, `error`.

| Method and path | Purpose |
|---|---|
| `POST /auth/google` | Exchange a Google ID token for an app session |
| `GET /me` | Current user |
| `POST /conversations`, `GET /conversations`, `DELETE /conversations/{id}` | Conversations |
| `GET /conversations/{id}/messages`, `GET /conversations/{id}/pending` | History and waiting approvals |
| `POST /conversations/{id}/messages` | Send a message (SSE) |
| `POST /approvals/{id}` | Approve or reject a pending action (SSE) |
| `POST /documents`, `GET /documents`, `PUT /documents/{id}/acl`, `DELETE /documents/{id}` | Documents |
| `GET/POST/DELETE /integrations/jira` | Jira connection status, connect, disconnect |
| `GET /admin/users`, `PUT /admin/users/{id}/roles`, `PUT /admin/users/{id}/active`, `GET /admin/audit` | Administration |

## Known limitations

- **Answers are validated before they appear**, so text arrives in chunks after generation
  finishes, not token by token as the model produces it. This is deliberate: raw streaming
  would bypass output guardrails.
- **Retrieval has no relevance cutoff.** Vector search always returns the nearest allowed
  chunks, and the model is instructed to say when they don't answer the question. Add a
  score threshold once you have real embeddings to calibrate against.
- **Resuming after approval loses earlier citations**: the resumed turn only cites sources
  retrieved after the approval.
- **PII detection is pattern based.** It catches cards (Luhn-checked), SSNs, keys and
  tokens, not free-form personal data such as names.
- **Only Jira** is integrated. Adding a tool server means adding it to `config/policy.yaml`
  and a gateway entry; Jira-specific credential handling is in `agent/jira_auth.py`.
- **One MCP server URL** is configured. Several servers need a small registry in the gateway.
- **Gemini free tier** limits and data terms (above).

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
| `/readyz` returns 503 | `postgres` or `qdrant` shows `error`; check `DATABASE_URL` / `QDRANT_*` |
| Slow first request on Render | Free instance waking from sleep |
