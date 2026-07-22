FROM node:22-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

FROM base AS deps

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/supervisor-framework/package.json packages/supervisor-framework/
COPY apps/personal-assistant/package.json apps/personal-assistant/
RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY tsconfig.base.json ./
COPY packages/supervisor-framework packages/supervisor-framework
COPY apps/personal-assistant apps/personal-assistant
RUN pnpm --filter @personal-assistant/supervisor-framework build \
 && pnpm --filter personal-assistant build

FROM base AS production

ENV NODE_ENV=production

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/supervisor-framework/package.json packages/supervisor-framework/
COPY apps/personal-assistant/package.json apps/personal-assistant/
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/packages/supervisor-framework/dist ./packages/supervisor-framework/dist
COPY --from=build /app/apps/personal-assistant/dist ./apps/personal-assistant/dist
COPY apps/personal-assistant/prompts ./apps/personal-assistant/prompts
COPY apps/personal-assistant/skills ./apps/personal-assistant/skills

WORKDIR /app/apps/personal-assistant

CMD ["node", "dist/index.js"]

FROM deps AS development

COPY tsconfig.base.json ./
COPY packages/supervisor-framework packages/supervisor-framework
COPY apps/personal-assistant apps/personal-assistant

WORKDIR /app/apps/personal-assistant

CMD ["pnpm", "dev"]
