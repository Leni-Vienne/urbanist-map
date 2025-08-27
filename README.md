# Construction Map

A full-stack construction mapping application built with Vue.js, tRPC, and deployed on Cloudflare Workers.

## 🚀 Deployment (Cloudflare Workers)

This application deploys both frontend and backend as a single Cloudflare Worker for optimal performance and simplicity.

### Prerequisites
- [Cloudflare account](https://cloudflare.com)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed

### Quick Deploy
1. **Build the frontend:**
   ```bash
   bun run build-front
   ```

2. **Deploy to Cloudflare Workers:**
   ```bash
   bun run deploy-worker
   ```

### Environment Variables
Set these in your Cloudflare Workers dashboard:
- `SESSION_ENCRYPTION_KEY` - 32+ character encryption key
- `DATABASE_URL` - PostgreSQL connection string
- `CF_ACCOUNT_ID` - Cloudflare account ID (for R2 uploads)
- `CF_API_TOKEN` - Cloudflare API token

## 🛠️ Development

### Local Development (Worker Mode)
```bash
# Install dependencies
bun install

# Build frontend
bun run build-front

# Start local Worker development server
bun run dev-worker
```

The application will be available at `http://127.0.0.1:8787`

### Environment Setup
1. Copy environment variables:
   ```bash
   cp .env.example .dev.vars
   ```

2. Update `.dev.vars` with your local configuration

### Database Setup (Optional)
For local development with database:

```bash
# Start local PostgreSQL with Docker
docker compose -f docker-compose.dev.yml up -d
```