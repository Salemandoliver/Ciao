# Ciao web PWA — Railway service
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @ciao/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
COPY tsconfig.base.json ./
# Every NEXT_PUBLIC_* is baked into the client bundle at build time, so each one
# has to be declared here as well as set on the service — a Docker build sees no
# environment it was not handed. A missing ARG does not fail anything: it builds
# a bundle where the value is `undefined`, which for the map keys means the app
# silently falls back to OpenStreetMap and looks like nothing was deployed.
# Changing any of these needs a rebuild, not a restart.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_MAPBOX_TOKEN
ENV NEXT_PUBLIC_MAPBOX_TOKEN=$NEXT_PUBLIC_MAPBOX_TOKEN
ARG NEXT_PUBLIC_GOOGLE_MAPS_KEY
ENV NEXT_PUBLIC_GOOGLE_MAPS_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_KEY
RUN pnpm --filter @ciao/web build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
COPY --from=build /app/apps/web/public apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
