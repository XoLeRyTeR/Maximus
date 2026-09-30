FROM node:22-bookworm-slim AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist ./dist
COPY backend/scripts/run.mjs backend/scripts/healthcheck.mjs ./scripts/
COPY backend/migrations ./migrations
COPY backend/certs ./certs
CMD ["node", "scripts/run.mjs", "prod"]
