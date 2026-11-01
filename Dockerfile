FROM node:24-alpine

WORKDIR /app

COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    SERVE_STATIC_APP=true \
    STATIC_SITE_DIR=/tmp/ai-commerce-hub-site \
    SOCIAL_COOKIE_SAMESITE=Lax \
    SOCIAL_TOKEN_STORE_PATH=/data/social-token-vault.json \
    DISCOVERY_STORE_PATH=/data/content-rewards-discovery.json \
    DISCOVERY_SCHEDULER_ENABLED=false

EXPOSE 3000

CMD ["node", "server.js"]
