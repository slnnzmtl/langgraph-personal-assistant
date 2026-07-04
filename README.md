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
- `OBSIDIAN_VAULT_PATH` (optional locally, defaults to `src/obsidian-vault`)

The assistant keeps only the last 10 messages per thread in state. Older turns are dropped once the conversation window exceeds that limit.

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