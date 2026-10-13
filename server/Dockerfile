# API + worker image (Chromium included via the official Playwright image)
FROM mcr.microsoft.com/playwright:v1.64.0-noble AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM mcr.microsoft.com/playwright:v1.64.0-noble
WORKDIR /app
ENV NODE_ENV=production
# Fonts for Urdu/Arabic & emoji so screenshots render correctly
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-core fonts-noto-color-emoji && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
ENV ARTIFACTS_DIR=/data/artifacts
EXPOSE 4000
CMD ["node", "dist/index.js"]
