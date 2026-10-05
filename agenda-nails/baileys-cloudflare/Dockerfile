FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tar \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY container ./container

ENV NODE_ENV=production
ENV WHATSAPP_AUTH_DIR=/data/auth

RUN mkdir -p /data/auth

EXPOSE 8080
CMD ["node", "container/server.mjs"]
