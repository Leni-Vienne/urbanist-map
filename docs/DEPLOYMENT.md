# Deployment

Two Docker Compose stacks (production and preview) run side-by-side on a single server, with separate Postgres DBs and ports. A host-level Caddy fronts both. The same machine also hosts the GitHub Actions self-hosted runner (`home-github-runner`), so the deploy step just copies files into place locally rather than over SSH.

## Stacks

|                  | Production                    | Preview                         |
| ---------------- | ----------------------------- | ------------------------------- |
| Branch trigger   | `production`                  | `preview`                       |
| Deploy dir       | `/opt/construction-map-prod`  | `/opt/construction-map-preview` |
| Compose project  | `construction-map-prod`       | `construction-map-preview`      |
| DB name          | `construction_map`            | `construction_map_preview`      |
| Backend port     | 3000                          | 3001                            |
| Postgres port    | 5432                          | 5433                            |
| Alloy port       | 12345                         | 12346                           |
| Hostname         | `api.urbanistmap.org`         | `preview-api.urbanistmap.org`   |
| R2 bucket        | `construction-map-production` | `construction-map-preview`      |
| CF Pages project | `construction-map`            | `construction-map-preview`      |

`INCLUDE_REVERSE_PROXY=true` (per-environment GitHub variable) makes [.github/workflows/deploy-and-migrate.yml](../.github/workflows/deploy-and-migrate.yml) install Caddy if missing and overwrite `/etc/caddy/Caddyfile` from [Caddyfile.host](../Caddyfile.host) on each deploy. Set it to `false` if a different reverse proxy fronts the box.
