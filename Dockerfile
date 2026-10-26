# The platform in one image: the API and the built studio behind one port.
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @av2i/studio build

# OpenTofu, the same pinned release the generated code is checked with (packages/testkit/scripts/tofu-check.ts)
FROM ghcr.io/opentofu/opentofu:1.12.9 AS tofu

FROM node:24-slim
# CA certificates: tofu downloads the AWS provider over HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=tofu /usr/local/bin/tofu /usr/local/bin/tofu
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=3000 STATIC_DIR=/app/apps/studio/dist
EXPOSE 3000
USER node
CMD ["node", "apps/api/src/main.ts"]
