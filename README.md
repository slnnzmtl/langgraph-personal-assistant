# Personal Assistant

## Local Development

Install dependencies and start the bot locally:

```sh
pnpm install
pnpm dev
```

The app requires these environment variables:

- `TELEGRAM_BOT_TOKEN`
- `ALLOWED_TELEGRAM_USER_ID`
- `GOOGLE_API_KEY`
- `GEMINI_MODEL` (optional)
- `APP_TIMEZONE` (optional, IANA timezone like `UTC` or `America/New_York`; invalid values fall back to `UTC`)
- `OBSIDIAN_VAULT_PATH` (optional locally, defaults to `src/obsidian-vault`)

### Finance Sync (Optional)

For automated Wise transaction syncing, additional setup is required:

- **Supabase Database:** See [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) for required `exec_sql` RPC function installation
- **Environment Variables:**
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `WISE_API_TOKEN`
  - `WISE_PROFILE_ID`

The assistant keeps only the last 10 messages per thread in state. Older turns are dropped once the conversation window exceeds that limit.

Within the Obsidian branch, the graph can now execute multiple note-file steps for one user request. It loops inside Obsidian until the task is complete, which allows read-then-write workflows like carrying unchecked tasks from yesterday into today.

The supervisor system prompt source of truth is `prompts/supervisor.md`.
The Obsidian system prompt source of truth is `prompts/obsidian.md`.
During local development and the dev container, the Obsidian prompt is reloaded on each invocation so prompt edits are picked up without restarting the process.

## Docker Compose

The Compose setup supports both production-style and development containers.

### Production-style container

Create a local `.env` file, then run:

```sh
docker compose up --build
```

By default the host markdown vault is mounted from `./src/obsidian-vault`. To use an external host directory instead, set `OBSIDIAN_VAULT_HOST_PATH` in your shell or `.env` before starting Compose.

Inside the container the app always writes to `/data/obsidian-vault`, passed through `OBSIDIAN_VAULT_PATH`.

### Development container

Run the dev profile when you want bind-mounted source and `pnpm dev` inside the container:

```sh
docker compose --profile dev up --build personal-assistant-dev
```

The dev service mounts the workspace into `/app`, keeps `node_modules` in a named Docker volume, and mounts the markdown vault separately so note files persist outside the container.