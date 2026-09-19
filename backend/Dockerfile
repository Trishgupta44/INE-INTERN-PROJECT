# Official Playwright image: Chromium and every system library it needs are preinstalled,
# so the free Render tier (no root, no apt) can run the scraper.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PORT=4000

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY scripts ./scripts

EXPOSE 4000
CMD ["node", "src/server.js"]
