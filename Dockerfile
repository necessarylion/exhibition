# 1. Build the Vue files (client and SSR bundle).
FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# 2. Install only the packages needed at run time.
FROM oven/bun:1.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# 3. The final image.
FROM oven/bun:1.4-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# tsconfig.json is needed at run time: it turns on decorator metadata for tsyringe.
COPY package.json tsconfig.json ./
COPY app ./app
COPY database ./database
COPY resources/views ./resources/views
USER bun
EXPOSE 3000
CMD ["bun", "app/index.ts"]
