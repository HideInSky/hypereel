# hypereel: notes for Claude

hypereel is the owner's entry to Comfy's **Open Source Higgsfield** challenge (https://comfy.org/open-source-higgsfield/). Read [docs/HANDOFF.md](docs/HANDOFF.md) first. It covers the challenge rules, the deadline, what has been built, what is live and what is left.

## How the owner works
- The owner writes in Chinese and English. Reply in the language of their latest message.
- **Never spend Comfy credits while building.** Use `COMFY_MODE=fake`. Run something that costs credits (`COMFY_MODE=workflow`, `npm run previews`, `npm run smoke`, a real render on the live site) only when the owner asks for it in this session, and say what it costs first.
- **Commit and push only when asked.** A push to `main` deploys to Railway and runs any new migrations on the live database.
- Before any destructive action (a data migration, dropping a table or column, deleting files), ask, and make sure a backup exists.
- Ask before installing system software (for example Docker Desktop), and before any decision with trade-offs: give the options briefly, with a recommendation.
- Keep the old deployment working until the new one is verified.
- Before starting work, look for installed skills that fit it (frontend-design, think-before-coding, built-in-browser and others) and use them.
- Subagents are allowed. The owner asked for Opus at high effort.
- The owner wants to learn CI/CD, so explain what you changed and why, and how to check it.
- When you finish a change, summarize it so the owner can explain it themselves.

## Secrets
- All config comes from environment variables. Never commit real secrets. Keep [.env.example](.env.example) current.
- The real `COMFY_API_KEY` lives only in the root `.env`, which is gitignored. On Railway it is a service variable. GitHub Secrets are for CI.
- The repo is **public**. Never write keys, tokens, personal paths or private details into a tracked file.

## Project shape (owner's dev guide)
- Node. Separate apps: `codebase/frontend` (React 19 + Vite) and `codebase/backend` (Fastify 5, Prisma 6, zod 4) talk over a REST API.
- PostgreSQL. Every schema change is a versioned Prisma migration in `codebase/backend/prisma/migrations/`, never manual SQL on a live DB. Prefer additive migrations.
- Docker: multi-stage `codebase/backend/Dockerfile` (it also builds the frontend), plus `docker-compose.yml` for local dev.
- CI: `.github/workflows/ci.yml` runs lint, test and build on every push, and pushes a SHA-tagged image when Docker Hub secrets are set. CI never deploys.
- Deploy: Railway builds from `main` (`railway.json`) and checks `/api/health`.
- Kubernetes + Argo CD are deferred to the roadmap in the README.

## Commands
```bash
npm install
npm run db:local -w codebase/backend         # embedded Postgres on :54329 (no Docker needed)
npm run migrate:deploy -w codebase/backend
npm run dev -w codebase/backend              # API on :3000 (set COMFY_MODE=fake)
npm run dev -w codebase/frontend             # app on :5173
npm run lint && npm run typecheck && npm test && npm run build   # all must pass before a push
```
`.claude/launch.json` has `db`, `backend`, `backend-fake` and `frontend` configs for the browser preview.

## Gotchas
- **Fake mode** uses an mp4 at `codebase/backend/test/fixtures/sample.mp4` if one exists (gitignored); otherwise it makes a 3-second test pattern with ffmpeg. Its music and sound effects are a sine tone, so fake "rain" doesn't sound like rain.
- **Workflow files:** after changing a workflow in `src/services/workflows.ts`, run `npm run export-workflows -w codebase/backend`. Otherwise the tests fail on stale files in `workflows/`.
- **Static files:** the backend caches the list of `frontend/dist` files at startup. After a frontend build, restart the backend.
- **Comfy SDK:** partner nodes need `apiKey` passed again on `client.submit` (separate from the constructor key). `job.wait()` doesn't throw on failure, so use `job.result()`.
- **H3 reference node:** use `MinimaxHailuo03ReferenceNode` with model "MiniMax H3 Max". Turbo isn't offered on that node.
- **Content:** don't reuse Higgsfield footage or real brands, characters or people's likenesses. Example clips use made-up characters.
- **Browser pane:** screenshots can lag one action behind, and native `<dialog>` modals don't show in them, so check state with JavaScript.
- **Library items:** Asset rows with `canvasId = null` belong to the Assets library, owned by the signed `sessionId` cookie. Saving and importing copy files, so a library item and a canvas card never share files.
