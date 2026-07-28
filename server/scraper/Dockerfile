# Runtime: Node.js (Outscrapper handles all scraping via API)
FROM node:20-slim

WORKDIR /app

# Copy dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy app code
COPY . .

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["node", "index.js"]
