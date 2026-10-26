# Enterprise Assistant frontend

Next.js 15 (App Router) + Tailwind 4. The browser only talks to this origin; route handlers
proxy to the FastAPI backend and keep the access token in an httpOnly `session` cookie.

## Setup
```
cp .env.example .env.local   # set NEXT_PUBLIC_GOOGLE_CLIENT_ID
npm install
npm run dev
```
Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`.

## Environment
- `BACKEND_URL` (default `http://localhost:8000`)
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (build-time; pass as a Docker build arg)
- `SESSION_COOKIE_SECURE` (`false` only for local http)

## Layout
- `src/app/api/auth/*` sign-in/out; `src/app/api/backend/[...path]` streaming proxy
- `src/lib/sse.ts` SSE parser, `src/lib/proxy.ts` proxy header logic (both unit-tested)
- `src/middleware.ts` redirects based on the `session` cookie

## UI
- Design tokens (light/dark) live in `src/app/globals.css` as CSS variables mapped into Tailwind; Geist and Geist Mono
  are self-hosted via `next/font/google` at build time. Icons are inline SVGs in `src/components/icons.tsx`.
- Theme (light/dark/system) is stored in `localStorage` (guarded with try/catch) and applied as `data-theme` on `<html>`
  by an inline script before first paint; "system" follows `prefers-color-scheme`.
- `src/components/AppShell.tsx` + `Sidebar.tsx`: collapsible sidebar (drawer below 768px) with conversation search/groups.
  The open conversation is the `?c=<id>` URL parameter. `/settings` shows the account view; `/settings?view=tools` shows
  Connected tools (Jira).
- Dialogs use the native `<dialog>` (`Modal.tsx`) for focus trapping and Escape handling.
- Navigation: every sidebar item and the brand mark are `next/link` anchors (`NavLink.tsx`, `aria-current` on the active
  route, pending spinner via `useLinkStatus`); item list/active logic is `src/lib/nav.ts`.
- Loading: each route segment under `src/app/(app)/` has a `loading.tsx` skeleton (`components/skeletons.tsx`) that mirrors
  the real layout. GET lists use `src/lib/useCachedFetch.ts` (tiny in-memory stale-while-revalidate store in
  `fetchCache.ts`, cleared on sign-out). Markdown, the Activity panel, dialogs and admin tables are loaded with `next/dynamic`.
  Streamed tokens are applied once per animation frame.
- A one-time "running on free tiers" notice (`FreeTierNotice.tsx`, localStorage key `notice.freeTier.v1`) opens after
  sign-in; re-open it from the sidebar footer or Settings.
- `/admin` has an "Invite a teammate" form and invitation list (`GET/POST/DELETE /v1/admin/invitations`). No email is sent;
  invitees sign in with Google using the invited address.
- `/admin` has no usage/cost/model-routing data because the backend exposes none; that section is an explicit
  "Not available yet" state. Users and the audit log are real.

## Agent activity
- The chat SSE stream carries `trace` events (and stored assistant messages carry `trace`). `src/lib/trace.ts` holds the
  pure helpers (parsing, ordering, pipeline node states, latency segments, summary) with tests in `trace.test.ts`.
- `src/components/activity/*` renders the pipeline strip, per-event cards (with "Show raw") and the summary; the right-hand
  panel (`chat/ContextPanel.tsx`) has Sources / Activity tabs and becomes a bottom sheet below 640px. It switches to
  Activity while streaming. An approval resume stream continues the trace of the message that asked for approval.
- Do not run `next build` in this folder while a dev server uses `.next`; build from a copy instead.

## Docker
```
docker build --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID=... -t assistant-web .
docker run -p 3000:3000 -e BACKEND_URL=http://backend:8000 assistant-web
```
