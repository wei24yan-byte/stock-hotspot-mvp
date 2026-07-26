# Market Radar V85 Migration Runbook

V85 keeps the current `app_state.primary-v2` row unchanged until the new data
store has passed all checks. Do not delete the legacy row during migration.

## 1. Local backup

Export the current Supabase row and record its SHA-256 checksum. The V85 working
copy keeps this backup under `backups/`, which is excluded from Git.

## 2. Create the V85 schema

Run `docs/supabase-v85.sql` in the Supabase SQL Editor.

## 3. Enable authentication

Enable Supabase email magic-link authentication and add the production and local
URLs to the authentication redirect allow list:

- `https://wei24yan-byte.github.io/stock-hotspot-mvp/`
- `http://127.0.0.1:8777/`
- `http://127.0.0.1:8778/`
- `http://127.0.0.1:8785/`

## 4. Migrate legacy data

Sign in from the V85 data panel and choose **Import V84 backup**. The browser
reads `primary-v2`, converts it to entity rows owned by the signed-in user, then
checks the following counts before recording the migration:

- stocks
- price rows
- plans
- reports
- trade logs
- snapshots
- deleted-stock tombstones

## 5. Configure server jobs

Add these GitHub repository secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_OWNER_ID`

The service-role key is server-only and must never be placed in frontend code.

`SUPABASE_OWNER_ID` is the signed-in user's UUID from Supabase
Authentication -> Users.

## 6. Deploy immediate history refresh

After installing and signing in to the Supabase CLI, run:

```bash
supabase link --project-ref ctbvxztqhosjoswiainz
supabase functions deploy refresh-stock
```

New stocks then receive up to 60 daily bars immediately. The 10-minute GitHub
Actions backfill remains the fallback when the Edge Function is unavailable.

## 7. Cut over

Run the V85 history and dashboard jobs manually. Verify mobile and desktop data,
then publish V85. Keep `primary-v2` read-only for at least seven days.

## 8. Rollback

Publish V84.3 again and restore `primary-v2` from the local backup. V85 entity
rows can remain in place because V84 does not read them.
