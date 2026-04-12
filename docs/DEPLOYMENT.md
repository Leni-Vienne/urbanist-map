# Urbanist Map Deployment Guide

## Infrastructure Overview

The application uses a **dual-stack deployment** architecture supporting both **production** and **preview** environments on the same server.

### Architecture

```
Cloudflare DNS
├── api.urbanistmap.org → YOUR_SERVER_IP:80/443
└── preview-api.urbanistmap.org → YOUR_SERVER_IP:80/443
                    ↓
            Host-level Caddy (port 80/443)
                    ├── api.urbanistmap.org → localhost:3000
                    └── preview-api.urbanistmap.org → localhost:3001
                                    ↓
                    Docker Containers
                    ├── Production Stack (/opt/urbanist-map-prod/)
                    │   ├── Backend (port 3000)
                    │   ├── PostgreSQL (port 5432)
                    │   └── Grafana Alloy (port 12345)
                    └── Preview Stack (/opt/urbanist-map-preview/)
                        ├── Backend (port 3001)
                        ├── PostgreSQL (port 5433)
                        └── Grafana Alloy (port 12346)
```

### Key Design Decisions

1. **Single `docker-compose.yml`**: Environment-agnostic with variable substitution
2. **Host-level Caddy**: Reverse proxy running outside Docker to avoid port conflicts
3. **Separate directories**: `/opt/urbanist-map-prod/` and `/opt/urbanist-map-preview/`
4. **Separate databases**: `construction_map` (prod) and `construction_map_preview`
5. **Separate R2 buckets**: `construction-map-production` and `construction-map-preview`

## Initial Server Setup

### Prerequisites

- Debian/Ubuntu server with Docker and Docker Compose installed
- Root or sudo access
- Cloudflare account with DNS management

### One-Time Setup

#### 1. Install Caddy (Host-Level Reverse Proxy)

**Option A: Automatic Deployment (Simple Setup)**

If you want the GitHub Actions workflow to automatically manage Caddy:

1. Set GitHub variable `INCLUDE_REVERSE_PROXY=true`
2. The workflow will automatically install Caddy and deploy `Caddyfile.host`

**Option B: Manual Management (VM/Complex Setup)**

If you have a layered proxy setup (e.g., host nginx → VM → Docker):

1. Set GitHub variable `INCLUDE_REVERSE_PROXY=false` (or leave unset)
2. Manually configure your reverse proxy to route:
   - `api.urbanistmap.org` → port 3000 (production)
   - `preview-api.urbanistmap.org` → port 3001 (preview)
3. Use `Caddyfile.host` as a reference for configuration

**Manual Caddy installation** (if needed):

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
sudo systemctl enable caddy
sudo systemctl start caddy
```

#### 2. Configure Cloudflare DNS

Add two A records pointing to your server IP:

| Type | Name        | Content        | Proxy Status |
| ---- | ----------- | -------------- | ------------ |
| A    | api         | YOUR_SERVER_IP | Proxied ☁️   |
| A    | preview-api | YOUR_SERVER_IP | Proxied ☁️   |

#### 3. Configure Cloudflare SSL/TLS

In Cloudflare dashboard → SSL/TLS:

- Set encryption mode to **"Flexible"** or **"Full"**

#### 4. Create Deployment Directories

```bash
sudo mkdir -p /opt/urbanist-map-prod
sudo mkdir -p /opt/urbanist-map-preview
```

#### 5. Configure GitHub Runners (Self-Hosted)

If using multiple self-hosted runners on different servers, configure them with labels:

**Production Server Runner:**

```bash
# On your production server
cd /path/to/actions-runner
./config.sh --url https://github.com/YOUR_ORG/YOUR_REPO \
  --token YOUR_TOKEN \
  --name production-runner \
  --labels self-hosted,production-server

# Start the runner
./run.sh
# Or install as service: sudo ./svc.sh install && sudo ./svc.sh start
```

**Preview Server Runner (optional):**

```bash
# On preview/test server
cd /path/to/actions-runner
./config.sh --url https://github.com/YOUR_ORG/YOUR_REPO \
  --token YOUR_TOKEN \
  --name preview-runner \
  --labels self-hosted,preview-server

# Start the runner
./run.sh
# Or install as service: sudo ./svc.sh install && sudo ./svc.sh start
```

**How it works:**

- Workflow uses `RUNNER_LABEL` variable from the active GitHub Environment
- Configure in **GitHub Settings → Environments → [production/preview] → Variables**:
  - **Production environment**: `RUNNER_LABEL = production-server`
  - **Preview environment**: `RUNNER_LABEL = preview-server`
- If using only one server, set both environments to the same label

## GitHub Actions Deployment

### Environment Detection

The workflow automatically detects the environment:

- **Production**: Branch `production`
- **Preview**: All other branches and PRs

### Deployment Flow

1. **Build frontend** → Deploy to Cloudflare Pages
2. **Build backend** → Bundle to `server.bundle.js`
3. **Determine environment** (prod or preview)
4. **Transfer files** to server via SCP
5. **Deploy to environment-specific directory**
6. **Generate `.env` file** with environment-specific values
7. **Start Docker Compose stack**
8. **Update Caddyfile** and reload Caddy

### GitHub Secrets Required

Configure these in GitHub repository settings:

**Secrets:**

- `REMOTE_USER` - SSH username for server
- `REMOTE_HOST` - Server IP address
- `REMOTE_PASSWORD` - SSH password
- `POSTGRES_PASSWORD` - PostgreSQL password (same for both envs or separate)
- `JWT_SECRET` - JWT signing secret
- `SMTP_USERNAME` - AWS SES SMTP username
- `SMTP_PASSWORD` - AWS SES SMTP password
- `R2_ACCESS_KEY_ID` - Cloudflare R2 access key
- `R2_SECRET_ACCESS_KEY` - Cloudflare R2 secret key
- `ALERT_EMAIL` - Email for error alerts
- `TURNSTILE_SECRET_KEY` - Cloudflare Turnstile secret
- `CF_API_TOKEN` - Cloudflare API token (for Pages deployment)
- `CF_ACCOUNT_ID` - Cloudflare account ID

**Variables:**

- `RUNNER_LABEL` - **Environment-specific**: Runner label to target (e.g., `production-server` for production, `preview-server` for preview)
- `INCLUDE_REVERSE_PROXY` - Set to `true` to enable automatic Caddy deployment, `false` to manage reverse proxy manually
- `VITE_API_BASE_URL` - API URL (set per environment in Cloudflare Pages)
- `VITE_R2_PUBLIC_URL` - R2 public URL
- `VITE_GOOGLE_CLIENT_ID` - Google OAuth client ID
- `VITE_TURNSTILE_SITE_KEY` - Turnstile site key
- `R2_ENDPOINT` - R2 endpoint URL
- `R2_BUCKET_NAME` - **Environment-specific**: R2 bucket name (use different buckets for prod/preview)
- `CORS_ORIGIN` - Allowed CORS origins
- `SES_REGION` - AWS SES region
- `FROM_EMAIL` - Email sender address
- `LOKI_URL` - Grafana Loki URL

## Manual Deployment

### Deploy Production

```bash
# Build backend
bun run build-back

# Transfer to server
scp server.bundle.js docker-compose.yml Caddyfile.host Dockerfile.bun-sharp alloy-config.alloy user@your-server:/tmp/
scp -r back/src/email user@your-server:/tmp/

# SSH to server
ssh user@your-server

# Deploy
cd /opt/urbanist-map-prod
sudo cp /tmp/server.bundle.js ./
sudo cp /tmp/docker-compose.yml ./
sudo cp /tmp/Dockerfile.bun-sharp ./
sudo cp /tmp/alloy-config.alloy ./
sudo mkdir -p back/src && sudo cp -r /tmp/email back/src/

# Create .env file (use .env.prod as template)
# Then start services
sudo docker compose up -d
```

### Deploy Preview

Same as production but use `/opt/urbanist-map-preview/` and `.env.preview`.

## Environment Configuration

### Production (.env.prod)

```bash
COMPOSE_PROJECT_NAME=construction-map-prod
NODE_ENV=production
POSTGRES_DB=construction_map
DB_PORT=5432
BACKEND_PORT=3000
ALLOY_PORT=12345
R2_BUCKET_NAME=construction-map-production
# ... other vars
```

### Preview (.env.preview)

```bash
COMPOSE_PROJECT_NAME=construction-map-preview
NODE_ENV=preview
POSTGRES_DB=construction_map_preview
DB_PORT=5433
BACKEND_PORT=3001
ALLOY_PORT=12346
R2_BUCKET_NAME=construction-map-preview
# ... other vars
```

## Monitoring & Troubleshooting

### Check Container Status

```bash
# Production
cd /opt/urbanist-map-prod
sudo docker compose ps

# Preview
cd /opt/urbanist-map-preview
sudo docker compose ps
```

### View Logs

```bash
# Production backend logs
cd /opt/urbanist-map-prod
sudo docker compose logs -f backend

# Preview backend logs
cd /opt/urbanist-map-preview
sudo docker compose logs -f backend

# Caddy logs
sudo journalctl -u caddy -f
```

### Health Checks

```bash
# Production health
curl https://api.urbanistmap.org/api/health

# Preview health
curl https://preview-api.urbanistmap.org/api/health
```

### Common Issues

#### Caddy Not Routing Correctly

```bash
# Check Caddyfile syntax
sudo caddy validate --config /etc/caddy/Caddyfile

# Reload Caddy
sudo systemctl reload caddy

# View Caddy logs
sudo journalctl -u caddy -n 100
```

#### Backend Not Accessible

```bash
# Check if backend is listening on correct port
sudo netstat -tlnp | grep :3000  # Production
sudo netstat -tlnp | grep :3001  # Preview

# Check Docker network
cd /opt/urbanist-map-prod
sudo docker compose exec backend nc -zv localhost 3000
```

#### Database Connection Issues

```bash
# Check PostgreSQL
cd /opt/urbanist-map-prod
sudo docker compose exec postgres pg_isready -U postgres

# View database logs
sudo docker compose logs postgres
```

## Updating Environments

### Update Production

Push to `production` branch → GitHub Actions automatically deploys

### Update Preview

Push to any other branch → GitHub Actions automatically deploys to preview

## Database Migrations

Migrations run automatically during GitHub Actions deployment, targeting the correct database for the environment:

```yaml
- name: Run database migrations
  # Runs against 'construction_map' (prod) or 'construction_map_preview' (preview)
  run: bun run db:migrate
```

For manual migrations:

```bash
# Default (Production)
bun run db:migrate

# Preview Environment
# Requires specifying the preview port and database name
POSTGRES_DB=construction_map_preview DB_PORT=5433 bun run db:migrate
```

## For Open Source Contributors

The preview environment is available for testing changes before they reach production.

**Current setup:**

- Preview deploys when pushing to any non-production branch
- Preview uses separate database and R2 bucket (isolated from production)
- Preview backend accessible at `preview-api.urbanistmap.org`

**Note:** Workflow for external PR testing is not yet finalized.

## Security Notes

- **Never commit** `.env` file (gitignored) - contains real secrets for local development
- **Safe to commit** `.env.prod` and `.env.preview` - these are templates with placeholders only
- Actual secrets come from GitHub Secrets/Variables during deployment
- Keep GitHub Secrets updated and rotated regularly
- Preview environment uses separate database but can share credentials
- Using separate R2 buckets for production and preview (configured in workflow)
