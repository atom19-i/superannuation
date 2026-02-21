# docker build -t blk-superannuation-iti-dargar .
# Base OS selection criteria: Alpine Linux is used for a minimal, secure runtime footprint.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public

EXPOSE 5477

ENV NODE_ENV=production
ENV PORT=5477

CMD ["node", "src/server.js"]
