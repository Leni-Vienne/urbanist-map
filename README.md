# Urbanist Map

A crowdsourced map of urban projects. Anyone can place a project on the world map and overlay its plans or renderings on top of the actual streets : [urbanistmap.org](https://urbanistmap.org)

![urbanistmap.org website](/docs/urbanistmap_website.png)

## What it does

The website provides a way to track proposed and under construction urban projects (roads, railways, buildings...) worldwide. This is something that I feel is missing. In fact it's very common to not even being aware of projects of a given city until they start or get delivered. Urbanistmap.org hopes to fix that.

The website relies on OpenStreetMap data as well as direct contributions made by logged-in users. They can add new projects in the form of lines and polygons, as well as adding top-down plans (images) of projects.

Submissions go through moderation before going public.

## Run it locally

```bash
cp .env.example .env
# then fill in POSTGRES_PASSWORD and COOKIE_SECRET
bun install
docker compose -f docker-compose.dev.yml --env-file .env up -d
bun run db:push
bun run dev-back   # :3000
bun run dev-front  # :5173
```

The app runs without R2, OAuth, or Turnstile credentials in dev (uploads stay local, captcha is skipped). Verification emails for signup are caught by the local mailpit instance, viewable at http://localhost:8025.

## Contributing

Issues and pull requests welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, test commands, i18n rules, and PR guidelines.

## License

[AGPL-3.0](LICENSE.md)
