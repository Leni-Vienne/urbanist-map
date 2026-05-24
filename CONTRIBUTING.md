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

Once you have an account, set `role` column to `admin` to moderate all countries, or set `moderated_countries` on your `users` row to an array of 3-letter country codes, like `'{"FRA","CHE"}'`.

## Project layout

```
back/         # Bun + Hono + tRPC + Drizzle backend
  src/
    routes/
    db/
    email/        # Nodemailer templates (i18n)
    scripts/      # GeoNames import, image cleanup, OSM import
front/
  src/
    components/
    services/
      map/
      overlay/
    composables/
    stores/
    locales/      # vue-i18n message catalogs
shared/       # types and zod schemas shared between front and back
docs/
scripts/
```

## Lint, typecheck, format

```bash
bun run lint
bun run typecheck
```

Formatting is handled by oxfmt via the pre-commit hook, so there's no Prettier config to fight with.

## Internationalization

All user-visible strings go through vue-i18n. English is the source of truth and the fallback: if you add or change a string, update [front/src/locales/messages/en.json](front/src/locales/messages/en.json) at minimum. Translations into the other locale files in [front/src/locales/messages/](front/src/locales/messages/) (currently `fr.json`) and the backend email catalogs in [back/src/email/i18n/](back/src/email/i18n/) are optional. Missing keys automatically fall back to English at runtime.

A useful sanity check:

```bash
bun run unused-translations
```

## License

[AGPL-3.0](LICENSE.md)
