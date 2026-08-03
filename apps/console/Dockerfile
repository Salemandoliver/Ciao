# Ciao Business — the standalone internal console (Railway service)
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/console/package.json apps/console/
RUN pnpm install --frozen-lockfile --filter @ciao/console...
COPY packages/shared packages/shared
COPY apps/console apps/console
COPY tsconfig.base.json ./
# NEXT_PUBLIC_API_URL must be present at build time (baked into the client bundle).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @ciao/console build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/console/.next/standalone ./
COPY --from=build /app/apps/console/.next/static apps/console/.next/static
COPY --from=build /app/apps/console/public apps/console/public
EXPOSE 3003
CMD ["node", "apps/console/server.js"]
