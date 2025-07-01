# ---------- Base layer: prod deps only ----------
FROM node:20-slim AS base
WORKDIR /app
COPY package*.json ./
COPY promptly-c3fc2-firebase-adminsdk-9ojxt-5ef13291e4.json ./
RUN npm ci --omit=dev

# ---------- Builder layer: add dev deps & compile ----------
FROM base AS builder
# package*.json are already present from the parent image
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npx tsc --build

# ---------- Runtime layer ----------
FROM node:20-slim
WORKDIR /app
COPY --from=base    /app/node_modules ./node_modules
COPY --from=builder /app/dist          ./dist
COPY --from=base    /app/promptly-c3fc2-firebase-adminsdk-9ojxt-5ef13291e4.json ./
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]