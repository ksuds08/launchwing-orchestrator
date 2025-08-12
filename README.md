# LaunchWing Orchestrator (Cloudflare Worker)

Endpoints:
- `GET /health` – status + env checks
- `POST /mvp?stream=true` – generate plan + files via agent, sanitize, push to GitHub
- `POST /github-export` – push arbitrary files to a new repo in the LaunchWing org
- `POST /sandbox-deploy` – (optional) ensure CF Pages project exists (GitHub-based)

## Required secrets (Worker environment)
- `GITHUB_TOKEN` (repo scope) – create/push repos in `GITHUB_ORG`
- `GITHUB_ORG` (e.g., `LaunchWing`)
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (for Pages project ops)
- `AGENT_URL` (e.g., `https://launchwing-agent.onrender.com`)
- `ORCHESTRATOR_URL` (public URL of this worker; used in injected _worker.ts)
- (optional) `OPENAI_API_KEY`, `OPENAI_MODEL` for fallback direct gen

Deploy via GitHub Actions: `.github/workflows/deploy-orchestrator.yml`