FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs ./
RUN mkdir -p /data/sessions
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data/sessions
EXPOSE 3000
CMD ["node","server.mjs"]
