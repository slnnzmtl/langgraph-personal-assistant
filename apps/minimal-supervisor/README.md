# Minimal Supervisor

A minimal supervisor pack using `@personal-assistant/supervisor-framework` with one `researcher` agent and a DuckDuckGo `web_search` tool.

## Setup

```bash
pnpm install
cp .env.example .env
# Set GOOGLE_API_KEY in .env
```

## Run

Interactive terminal chat (no arguments):

```bash
pnpm --filter minimal-supervisor dev
```

One-shot question:

```bash
pnpm --filter minimal-supervisor dev -- "What is the capital of France?"
```

From this directory:

```bash
pnpm dev
pnpm dev -- "What is the capital of France?"
```

## Build

```bash
pnpm --filter minimal-supervisor build
pnpm --filter minimal-supervisor start -- "hello"
```
