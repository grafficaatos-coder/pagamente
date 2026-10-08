FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.mjs ./
COPY auth-state.mjs ./

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data

RUN mkdir -p /data

EXPOSE 8080
CMD ["node", "server.mjs"]
