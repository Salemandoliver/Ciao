# Ciao Partners — the standalone control panel for supply (Railway service)
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/partner/package.json apps/partner/
RUN pnpm install --frozen-lockfile --filter @ciao/partner...
COPY packages/shared packages/shared
COPY apps/partner apps/partner
COPY tsconfig.base.json ./
# NEXT_PUBLIC_API_URL must be present at build time (baked into the client bundle).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @ciao/partner build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/partner/.next/standalone ./
COPY --from=build /app/apps/partner/.next/static apps/partner/.next/static
COPY --from=build /app/apps/partner/public apps/partner/public
EXPOSE 3002
CMD ["node", "apps/partner/server.js"]
