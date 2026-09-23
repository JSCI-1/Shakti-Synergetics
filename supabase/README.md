# Supabase Database Migrations

This folder contains all SQL migration files for the Shakti Synergetics project.

## How to run

1. Go to **https://supabase.com/dashboard**
2. Select your project
3. Left sidebar → **SQL Editor** → **New query**
4. Paste the SQL from the migration file you want to run
5. Click **Run**

---

## Migration files

### `001_thermopack_job_cards.sql`
Run this first. Creates:
- **`thermopack_job_cards`** — main Thermopack Operator job card form
- **`motor_amp_status`** — Running Motor Amp Status section

### `002_slurry_job_cards.sql`
Run this second. Creates:
- **`slurry_job_cards`** — Slurry Section Process Job Card
- **`batch_traceability`** — Batch Traceability Records

---

## Table summary

| Table | Description |
|---|---|
| `thermopack_job_cards` | Date, shift, operator, helpers, stock received, fuel charged, hourly log (10L & 6L), summary fields, remarks |
| `motor_amp_status` | Running motor amp readings per date |
| `slurry_job_cards` | Process job card with batch columns, input rows, sand milling details |
| `batch_traceability` | Batch charging → HST → LST → Storage → Finish Slurry traceability |

---

## Notes

- All `jsonb` columns store arrays of objects (see comments in each SQL file for exact structure)
- Row Level Security is enabled on all tables with anon insert/select policies
- The anon key in `.env` (`VITE_SUPABASE_ANON_KEY`) is used by the app to read and write
