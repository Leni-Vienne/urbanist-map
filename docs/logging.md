# Request Logging Documentation

## Overview

The application now includes comprehensive request logging using pino, with automatic log rotation, error alerting via email, and Cloudflare header extraction.

## Environment Variables

### Required
- `ALERT_EMAIL` - Email address to receive error alerts when threshold is exceeded

### Optional
- `LOG_LEVEL` - Log level (default: `info`). Options: `debug`, `info`, `warn`, `error`
- `LOG_STATIC` - Set to `true` to log static asset requests in development (default: `false`)

## Log Format

### Development
- **Output**: Console with pretty-printing
- **Format**: Single-line, colorized
- **Example**: `18:34:06 GET /api/health → 200 (5ms)`
- **Static assets**: Filtered out by default (set `LOG_STATIC=true` to log them)

### Production
- **Output**: Both console (for Docker logs) and file (for persistence)
- **Format**: JSON Lines (.jsonl) - one JSON object per line
- **File location**: `./logs/access.log`
- **Rotation**: Daily at midnight
- **Retention**: 15 days

## Log Fields

Each log entry includes:

| Field | Description | Example |
|-------|-------------|---------|
| `timestamp` | When the request occurred | `2024-12-07T18:34:06.816Z` |
| `level` | Log level | `info`, `warn`, `error` |
| `method` | HTTP method | `GET`, `POST`, `PUT`, `DELETE` |
| `path` | Request path | `/api/health`, `/trpc/project.list` |
| `status` | HTTP status code | `200`, `404`, `500` |
| `duration` | Response time in ms | `145` |
| `ip` | Client IP address | `203.0.113.45` |
| `cfCountry` | Country code (Cloudflare) | `FR`, `US`, `GB` |
| `cfRay` | Cloudflare Ray ID | `82a1b2c3d4e5f6g7` |
| `userAgent` | User agent string | `Mozilla/5.0...` |
| `userId` | Authenticated user ID | `42` (null if not logged in) |

## Log Files Location

### Development (local)
```
logs/
└── (empty - logs go to console only)
```

### Production
```
logs/
├── access.log              # Current day (symlink or active file)
├── access-2024-12-07.log  # Archived daily logs
├── access-2024-12-06.log
└── ...                    # Automatically deleted after 15 days
```

### Docker Production
Logs persist in the `backend_logs` volume:
```bash
# View logs from Docker
docker exec construction-map-backend cat /app/logs/access.log

# View via Portainer
# Navigate to: Containers > construction-map-backend > Volumes > backend_logs
```

## Querying Logs

### Using `jq` (JSON query tool)

```bash
# Count errors today
cat logs/access.log | jq 'select(.status >= 500)' | wc -l

# Find slowest requests
cat logs/access.log | jq 'select(.duration > 1000)' | jq -s 'sort_by(.duration) | reverse | .[0:10]'

# Group by status code
cat logs/access.log | jq .status | sort | uniq -c

# Find all requests from a specific IP
cat logs/access.log | jq 'select(.ip == "203.0.113.45")'

# Get average response time
cat logs/access.log | jq .duration | awk '{sum+=$1; n++} END {print sum/n}'
```

### Using `grep`

```bash
# Find all  500 errors
grep '"status":500' logs/access.log

# Find all requests to a specific endpoint
grep '"/api/health"' logs/access.log

# Find requests from France
grep '"cfCountry":"FR"' logs/access.log
```

### Using PostgreSQL (if you implement aggregation)

```sql
-- Example: Import logs to PostgreSQL for analysis
CREATE TABLE request_logs_archive (
  log_data JSONB
);

-- Import (using COPY command or pg_bulkload)
-- COPY request_logs_archive FROM '/path/to/access.log';

-- Query
SELECT 
  log_data->>'method' as method,
  log_data->>'path' as path,
  COUNT(*) as requests,
  AVG((log_data->>'duration')::int) as avg_ms
FROM request_logs_archive
WHERE (log_data->>'timestamp')::timestamp > NOW() - INTERVAL '7 days'
GROUP BY method, path
ORDER BY requests DESC
LIMIT 10;
```

## Error Alerting

### Configuration
- **Threshold**: 10 errors (4xx or 5xx) within 5 minutes
- **Cooldown**: 30 minutes (won't send duplicate alerts)
- **Check interval**: Every 5 minutes
- **Email**: Sent to `ALERT_EMAIL` environment variable

### Alert Email Contents
- Total error count in last 5 minutes
- Breakdown by endpoint
- Table of recent errors with details (time, endpoint, status, message)

### Email Service
- **Development**: Mailpit (localhost:1025) - view at http://localhost:8025
- **Production**: AWS SES

### Testing Error Alerts Locally

1. Set `ALERT_EMAIL` in `.env`:
   ```env
   ALERT_EMAIL=admin@example.com
   ```

2. Trigger errors (make 10+ failed requests):
   ```bash
   for i in {1..12}; do curl http://localhost:3000/api/nonexistent; done
   ```

3. Wait 5 minutes for check interval

4. Open Mailpit: http://localhost:8025

## Cloudflare Headers

When deployed behind Cloudflare, the following headers are captured:

| Header | Purpose | Example |
|--------|---------|---------|
| `CF-Connecting-IP` | Real client IP (used instead of `X-Forwarded-For`) | `203.0.113.45` |
| `CF-IPCountry` | Client's country code | `FR`, `US`, `DE` |
| `CF-Ray` | Unique request ID from Cloudflare | `82a1b2c3d4e5f6g7` |

**Important**: Always use `CF-Connecting-IP` for the real client IP, as `X-Forwarded-For` can be spoofed.

## Log Rotation

### How it works
- **Trigger**: Automatically at midnight (00:00) each day
- **Naming**: `access-YYYY-MM-DD.log`
- **Cleanup**: Files older than 15 days are automatically deleted
- **Max size**: 10MB per file (creates new file if exceeded)

### Manual rotation (if needed)
```bash
# Stop backend
docker-compose stop backend

# Rename current log
mv logs/access.log logs/access-$(date +%Y-%m-%d).log

# Start backend (will create new access.log)
docker-compose start backend
```

## Performance Considerations

### Logging is non-blocking
- Logs are written **after** the response is sent to the client
- Logging failures don't crash the server (errors logged to console)

### Static asset filtering
- In development, `/uploads/*` requests are not logged by default
- Reduces log noise from image thumbnails
- Set `LOG_STATIC=true` to log them

### Production file I/O
- Uses buffered writes (pino-roll)
- Minimal performance impact (< 1ms per request)

## Migration to External Services

When ready to migrate to a remote logging service (BetterStack, Axiom, Grafana Loki, etc.):

### Option 1: Ship existing log files
```bash
# Install a log shipper (e.g., Fluent Bit, Vector, Promtail)
# Point it at ./logs/access.log
# Configure destination (HTTP endpoint, S3, etc.)
```

### Option 2: Add HTTP transport to pino
```typescript
// In back/src/services/logger.ts
export const logger = pino({
  transport: {
    targets: [
      { target: 'pino-roll', options: {...} },           // File (existing)
      { target: 'pino-http-send', options: {             // Remote service (new)
        url: 'https://logs.yourservice.com/ingest',
        headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
      }}
    ]
  }
});
```

### Option 3: Use Docker logs
External services can ingest from `docker logs`:
```bash
# Logs already go to stdout in production
docker logs construction-map-backend --follow | your-log-agent
```

## Troubleshooting

### Logs not appearing in console (development)
- Check that `NODE_ENV` is set to `development`
- Verify backend is running: `bun run dev-back`
- Check `LOG_LEVEL` isn't set to `error`

### Log files not created (production)
- Check `./logs/` directory exists and is writable
- Verify `NODE_ENV` is set to `production`
- Check Docker volume is mounted: `docker inspect construction-map-backend`

### Error alerts not sending
- Verify `ALERT_EMAIL` is set in environment
- Check SMTP configuration (Mailpit or AWS SES)
- Ensure 10+ errors occurred within 5 minutes
- Wait for  5-minute check interval
- Check backend console for error messages

### Too many logs
- **Development**: Set `LOG_STATIC=false` (default) to filter static assets
- **Production**: Increase `LOG_LEVEL` to `warn` or `error`
- **Both**: Exclude specific paths in middleware (edit `requestLogger.ts`)

### Logs filling up disk
- Verify rotation is working (check for dated files)
- Verify cleanup is working (files older than 15 days deleted)
- Reduce retention period (edit `limit.count` in `logger.ts`)
- Enable log compression (add compression to pino-roll options)

## Example: Daily Log Analysis Script

```bash
#!/bin/bash
# AI : Analyze yesterday's logs and email summary

YESTERDAY=$(date -d "yesterday" +%Y-%m-%d)
LOG_FILE="logs/access-${YESTERDAY}.log"

if [ ! -f "$LOG_FILE" ]; then
    echo "Log file not found: $LOG_FILE"
    exit 1
fi

# Generate summary
{
    echo "Log Summary for $YESTERDAY"
    echo "======================================"
    echo ""
    echo "Total Requests: $(wc -l < "$LOG_FILE")"
    echo ""
    echo "By Status Code:"
    jq -r .status "$LOG_FILE" | sort | uniq -c | sort -rn
    echo ""
    echo "Top 10 Endpoints:"
    jq -r .path "$LOG_FILE" | sort | uniq -c | sort -rn | head -10
    echo ""
    echo "Average Response Time: $(jq .duration "$LOG_FILE" | awk '{sum+=$1; n++} END {print sum/n}')ms"
    echo ""
    echo "Errors (5xx):"
    jq 'select(.status >= 500)' "$LOG_FILE" | jq -s length
} | mail -s "Construction Map - Log Summary $YESTERDAY" admin@example.com
```

## Security & Privacy

### What's logged
✅ IP addresses (for rate limiting, abuse detection)
✅ HTTP methods, paths, status codes
✅ User IDs (for authenticated users)
✅ Cloudflare headers (country, ray ID)
✅ Response times
✅ User agents

### What's NOT logged
❌ Request/response bodies (no passwords, tokens, form data)
❌ Auth headers (no JWT tokens, API keys)
❌ Query parameters (may contain sensitive data)
❌ Cookies (except session existence)

### GDPR Compliance
- Inform users in privacy policy that logs are collected
- 15-day retention period (configurable)
- IP addresses can be considered personal data
- Users can request log deletion (manual process)

### For GDPR-strict environments
Consider anonymizing IPs:
```typescript
// In requestLogger.ts
const ip = getClientIp(c);
const anonymizedIp = ip ? ip.split('.').slice(0, 3).join('.') + '.0' : undefined;
```

Or disable IP logging entirely by removing `ip` from log output.
