# Minimal relay image. Build context = this server/ directory.
FROM node:20-alpine
WORKDIR /app
# only dependency is `ws`
RUN npm init -y >/dev/null 2>&1 && npm i ws@8 --no-audit --no-fund
COPY server-ws.js ./
ENV PORT=8088
EXPOSE 8088
CMD ["node", "server-ws.js"]
