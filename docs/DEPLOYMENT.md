# Deployment

Two Docker Compose stacks (production and preview) run side-by-side on a single server, with separate Postgres DBs and ports. A host-level Caddy fronts both. The same machine also hosts the GitHub Actions self-hosted runner (`home-github-runner`), so the deploy step just copies files into place locally rather than over SSH.

## Stacks

|                  | Production                   | Preview                            |
| ---------------- | ---------------------------- | ---------------------------------- |
| Branch trigger   | `production`                 | `preview`                          |
| Deploy dir       | `/opt/construction-map-prod` | `/opt/construction-map-preview`    |
| Compose project  | `construction-map-prod`      | `construction-map-preview`         |
| DB name          | `construction_map`           | `construction_map_preview`         |
| Backend port     | 3000                         | 3001                               |
| Postgres port    | 5432                         | 5433                               |
| Alloy port       | 12345                        | 12346                              |
| Hostname         | `api.urbanistmap.org`        | `preview-api.urbanistmap.org`      |
| R2 bucket        | `construction-map-uploads`   | `construction-map-preview-uploads` |
| CF Pages project | `construction-map`           | `construction-map-preview`         |
| `JOURNAL_UNIT`   | `osm-update.service`         | empty                              |

Both stacks mount the host journal read-only, so `JOURNAL_UNIT` is what keeps the daily OSM refresh
from being ingested twice under identical stream labels. Query it in Loki with
`{service="osm-update"}`; leaving the variable set on both stacks would double the ingest and give
no label to tell the copies apart. Setting it to a unit that logs continuously would ship that unit's
full output, so keep it on the once-a-day timer.

`INCLUDE_REVERSE_PROXY=true` (per-environment GitHub variable) makes [.github/workflows/deploy-and-migrate.yml](../.github/workflows/deploy-and-migrate.yml) install Caddy if missing and overwrite `/etc/caddy/Caddyfile` from [Caddyfile.host](../Caddyfile.host) on each deploy. Set it to `false` if a different reverse proxy fronts the box.

## Local dev against a deployed database

A `DATABASE_URL` pointing at one of those DBs also needs that same row's R2 bucket, since approved
overlays keep their image only there (local disk holds the pending uploads). With
`NODE_ENV=development` and the four `R2_*` variables set, `/uploads/*` falls back to the bucket after
a local miss. A DB paired with the other stack's bucket serves 404s for every approved overlay.

Nothing writes to R2 outside `NODE_ENV=production`: approval queues no migration and cleanup deletes
locally. An object-read-only R2 API token therefore covers local dev.
