# Ciao API — Railway service
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @ciao/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY tsconfig.base.json ./
RUN pnpm --filter @ciao/api build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter @ciao/api...
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
WORKDIR /app/apps/api
# Migrations run on boot, then the server (worker runs in-process by default).
# SEED_ON_BOOT=true additionally runs the idempotent demo seed (one-off, then unset).
CMD ["sh", "-c", "node dist/db/migrate.js && if [ \"$SEED_ON_BOOT\" = \"true\" ]; then node dist/db/seed.js; fi && node dist/server.js"]
