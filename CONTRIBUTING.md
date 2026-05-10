# Contributing

For dev environment setup (deps, `.env`, docker, dev servers), see the [README](README.md#run-it-locally). Everything below is the contributor-specific stuff that doesn't belong there.

## Database

```bash
bun run db:push
```

`db:push` syncs the Drizzle schema directly against your local DB. **Do not** run `db:generate` (which writes a committed migration) unless you have a deliberate reason to add a migration to the repo.

The GeoNames cities import is optional (most projects no longer rely on `city_id`):

```bash
bun run db:fill
```

## Becoming a local moderator

Once you have an account, set `moderated_countries` on your `users` row to an array of ISO codes, e.g. `'{"FRA","CHE"}'`. You can then exercise the moderation flows for those countries.

## Project layout

```
back/         # Bun + Hono + tRPC + Drizzle backend
  src/
    routes/       # tRPC routers
    db/           # Drizzle schema, queries, visibility helpers
    email/        # Nodemailer templates (i18n)
    scripts/      # one-off scripts (GeoNames import, image cleanup, OSM import)
front/        # Vue 3 + Vite frontend
  src/
    components/   # Vue components
    services/
      map/        # Leaflet + MapLibre orchestration, tile layers, vector layers
      overlay/    # overlay rendering, lifecycle, render registry
    composables/  # Vue composables (viewport, keyboard, etc.)
    stores/       # Pinia stores
    locales/      # vue-i18n message catalogs
shared/       # types shared between front and back
docs/         # additional documentation (deployment, GeoNames, tile layers)
scripts/      # repo-level scripts (translation usage, OSM extracts)
```

## Lint, typecheck, format

```bash
bun run lint        # oxlint, type-aware
bun run typecheck   # vue-tsc --noEmit
```

Formatting is handled by oxfmt via the pre-commit hook, so there's no Prettier config to fight with.

## Internationalization

All user-visible strings go through vue-i18n. English is the source of truth and the fallback: if you add or change a string, update [front/src/locales/messages/en.json](front/src/locales/messages/en.json) at minimum. Translations into the other locale files in [front/src/locales/messages/](front/src/locales/messages/) (currently `fr.json`) and the backend email catalogs in [back/src/email/i18n/](back/src/email/i18n/) are optional. Missing keys automatically fall back to English at runtime.

A useful sanity check:

```bash
bun run unused-translations
```

## Opening a PR

For UI changes, attach a screenshot or short clip in the PR description. That's it.

## License

By contributing, you agree your contributions will be licensed under [AGPL-3.0](LICENSE.md), the same license as the rest of the project.
