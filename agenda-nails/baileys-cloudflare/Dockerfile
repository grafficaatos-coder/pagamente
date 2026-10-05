FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY container ./container

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "container/server.mjs"]
