# The platform in one image: the API and the built studio behind one port.
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @av2i/studio build

FROM node:24-slim
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=3000 STATIC_DIR=/app/apps/studio/dist
EXPOSE 3000
USER node
CMD ["node", "apps/api/src/main.ts"]
