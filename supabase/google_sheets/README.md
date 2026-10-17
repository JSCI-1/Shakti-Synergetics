# Google Sheets Sync — Deploy Notes

One-way **Supabase → Google Sheets** sync for the Dryer Operator and Quality
Control (Finished Goods, Raw Material, and In-Process all live) modules.
Supabase stays authoritative; the sync never blocks or fails a save, and failed
syncs are retriable.

> Migrations now run `001 … 026`. Later QC migrations (024/025/026) re-define
> the shared QC trigger with `create or replace` and add per-section re-queue
> helpers; always apply them in numeric order, after 021/022.

> Global constraint for this workflow: **no `git push`, no PR, no commit, no
> branch, no worktree.** Everything here is a local, uncommitted change. The
> steps below are performed by **you** (the operator), by hand — Kiro created
> the files only.

Artifacts in this feature:

| File | Where it runs | How it is applied |
|---|---|---|
| `supabase/migrations/021_sheets_sync_outbox.sql` | Postgres (Supabase) | **By hand** in the SQL Editor |
| `supabase/migrations/022_sheets_sync_triggers.sql` | Postgres (Supabase) | **By hand** in the SQL Editor, **after 021** |
| `supabase/functions/sheets-sync-pull/index.ts` | Supabase Edge (Deno) | **CLI** `supabase functions deploy` |
| `supabase/functions/sheets-sync-ack/index.ts` | Supabase Edge (Deno) | **CLI** `supabase functions deploy` |
| `supabase/google_sheets/apps-script/Code.gs` | Google Apps Script | Pasted / `clasp push`, deployed as Web App |
| `supabase/google_sheets/apps-script/appsscript.json` | Google Apps Script | Pasted / `clasp push` |

No SQL object is applied in two places. Migrations are **SQL Editor only**
(this project has no CLI migration runner — see the inspection report §0/§9 and
the existing `001…020` files). Edge Functions are **CLI only** (never pasted
into the SQL Editor). Apps Script is **Google-side only**.

A complete, beginner-friendly, click-by-click walkthrough lives at the repo
root in [`GOOGLE_SHEETS_SETUP_GUIDE.md`](../../GOOGLE_SHEETS_SETUP_GUIDE.md).
This file is the short deploy checklist for someone already familiar with the
tools.

---

## Why polling (not a Supabase Database Webhook)

Apps Script **pulls** from a secret-guarded Edge Function on a time trigger,
rather than Supabase pushing a webhook (design §2). Reasons: no new Postgres
extension (`pg_net`/`http`) has to be enabled; the durable outbox survives Apps
Script downtime (rows wait); and retry is trivial (unacked rows are re-served).

---

## 1. Apply the migrations (Supabase SQL Editor — by hand, in order)

**021 strictly before 022.** 022's trigger functions `insert into
sheets_sync_outbox`, which 021 creates.

1. Supabase Dashboard → SQL Editor → New query.
2. Paste the whole contents of `021_sheets_sync_outbox.sql`, Run. Verify:
   ```sql
   select count(*) from sheets_sync_outbox;              -- 0, table exists
   ```
3. New query. Paste `022_sheets_sync_triggers.sql`, Run. Verify the triggers:
   ```sql
   select tgname, tgrelid::regclass
     from pg_trigger
    where tgname like 'trg_sheets_sync_%';               -- 3 rows
   ```

Both files are safe to re-run (`create table if not exists`,
`create or replace function`, `drop trigger if exists … ; create trigger …`).
Re-running 021 never drops accumulated pending work.

## 2. Deploy the Edge Functions + set their secrets (CLI only)

> **CRITICAL — disable JWT verification on these two functions.** They
> authenticate themselves with the `x-sheets-sync-secret` shared-secret header,
> NOT a Supabase JWT. If JWT verification is left ON (the deploy default),
> Supabase's gateway returns **401 before the function code runs**, the Apps
> Script worker aborts every tick, and NO data reaches Google Sheets while rows
> pile up as `pending` in `sheets_sync_outbox`. This is the #1 cause of "I did
> all the setup but nothing shows in the sheet."
>
> `supabase/config.toml` already pins `verify_jwt = false` for both functions,
> so a plain `supabase functions deploy …` picks it up. If you deploy without
> that config (or from an older CLI), pass the flag explicitly as shown below.

```sh
supabase functions deploy sheets-sync-pull --no-verify-jwt
supabase functions deploy sheets-sync-ack --no-verify-jwt

supabase secrets set SHEETS_SYNC_SECRET="<generated-shared-secret>"
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform to
# deployed functions. Set them explicitly only if your project requires it:
# supabase secrets set SUPABASE_URL="https://<ref>.supabase.co"
# supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
```

Note the two deployed function URLs (`…/functions/v1/sheets-sync-pull` and
`…/functions/v1/sheets-sync-ack`) for the Apps Script `PULL_URL` / `ACK_URL`.

## 3. Apps Script (Google-side only)

Paste `Code.gs` + `appsscript.json` into a new Apps Script project (or
`clasp push`), set the Script Properties below, authorize scopes, run
`installTrigger` once, then deploy as a Web App.

---

## Configuration template (PLACEHOLDERS only — never commit real secrets)

### Supabase Edge Function secrets (`supabase secrets set …`)

| Secret | Value (placeholder) | Redeploy needed on change? |
|---|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` | Platform-provided; no redeploy, functions read it at runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | `<service-role-key>` | Platform-provided; no redeploy |
| `SHEETS_SYNC_SECRET` | `<generated-shared-secret>` | No code redeploy; `secrets set` takes effect on the next invocation |

### Apps Script Script Properties (Project Settings → Script properties)

| Property | Value (placeholder) | Redeploy needed on change? |
|---|---|---|
| `SHEETS_SYNC_SECRET` | `<same-shared-secret-as-above>` | No; read on each tick |
| `PULL_URL` | `https://<project-ref>.supabase.co/functions/v1/sheets-sync-pull` | No; read on each tick |
| `ACK_URL` | `https://<project-ref>.supabase.co/functions/v1/sheets-sync-ack` | No; read on each tick |
| `SPREADSHEET_ID_DRYER` | `<dryer-spreadsheet-id>` | No; read on each tick |
| `SPREADSHEET_ID_QC` | `<qc-spreadsheet-id>` | No; read on each tick |

`SHEETS_SYNC_SECRET` must be **identical** in the Edge Function secrets and the
Apps Script Script Properties — it is the shared secret the `x-sheets-sync-secret`
header carries. Rotating it: set the new value in both places (order does not
matter beyond a brief window where ticks 401 until both match).
