-- ════════════════════════════════════════════════════════════
-- ONE-TIME REPAIR — Old Dryer log sheet of 13 Nov 2026
-- Run in: Supabase Dashboard → SQL Editor. Run STEP 0, then STEP 1 and check
-- it, then STEP 2 — each STEP on its own (select its text and click Run).
--
-- WHAT WENT WRONG: "Save Log Sheet" (14 Nov 07:40 IST) stored the submitting
-- browser's UNSAVED copy of the 08:00 hour (No. of Bag Per Hours(25) / Bag Size
-- By Wt.(25) blank, Kg./Hour 0). The saved hour on the server
-- (dryer_hourly_draft) has 14 / 50.
--
-- WHAT THIS DOES: rewrites ONLY that one dryer_logs record (dryer 'old', date
-- 2026-11-13):
--   • each of the 24 log rows is replaced by the server's latest saved copy of
--     that hour (the same data Production Activity shows); an hour the server
--     does not have is left as stored;
--   • the hourly totals (Total Kg./Hour Production and, when migration 066 is
--     applied, the four bag totals) are recalculated from the repaired rows.
--
-- SAFE: UPDATE only — dryer_logs has only AFTER INSERT triggers, so NO email is
-- sent and NOTHING is re-synced to Google Sheets. No other record is touched.
-- ════════════════════════════════════════════════════════════


-- ── STEP 0 — BACKUP the record as it is now (changes nothing in dryer_logs) ──
create table if not exists dryer_logs_backup_20261113_old as
  select * from dryer_logs where dryer_type = 'old' and date = '2026-11-13';
select count(*) as backed_up_rows from dryer_logs_backup_20261113_old;   -- expect 1


-- ── STEP 1 — PREVIEW (changes nothing) ──────────────────────────────────────
-- One line per hour where the stored log differs from the server's saved hour.
with slots as (
  select hour, idx::int
  from unnest(array['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00',
                    '16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00',
                    '00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00'])
       with ordinality as t(hour, idx)
), latest as (
  select distinct on (hour) hour, values
  from dryer_hourly_draft
  where dryer_type = 'old' and log_date = '2026-11-13'
  order by hour, last_saved_at desc
), rec as (
  select id, log_rows from dryer_logs where dryer_type = 'old' and date = '2026-11-13'
)
select s.hour,
       rec.log_rows->(s.idx - 1)->>'bags_per_hr'    as log_bags_25,   l.values->>'bags_per_hr'    as server_bags_25,
       rec.log_rows->(s.idx - 1)->>'bag_size_wt'    as log_size_25,   l.values->>'bag_size_wt'    as server_size_25,
       rec.log_rows->(s.idx - 1)->>'bags_per_hr_50' as log_bags_5010, l.values->>'bags_per_hr_50' as server_bags_5010,
       rec.log_rows->(s.idx - 1)->>'bag_size_wt_50' as log_size_5010, l.values->>'bag_size_wt_50' as server_size_5010,
       rec.log_rows->(s.idx - 1)->>'kg_per_hr'      as log_kg,        l.values->>'kg_per_hr'      as server_kg
from rec
cross join slots s
join latest l on l.hour = s.hour
where (rec.log_rows->(s.idx - 1)) - array['saved','__last_saved_at','__finalized']
   is distinct from (l.values - array['saved','__last_saved_at','__finalized'])
order by s.idx;


-- ── STEP 2 — REPAIR (run after checking STEP 1) ─────────────────────────────

-- 2a. Replace each stored hour with the server's latest saved copy.
with slots as (
  select hour, idx::int
  from unnest(array['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00',
                    '16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00',
                    '00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00'])
       with ordinality as t(hour, idx)
), latest as (
  select distinct on (hour) hour, values
  from dryer_hourly_draft
  where dryer_type = 'old' and log_date = '2026-11-13'
  order by hour, last_saved_at desc
), rec as (
  select id, log_rows from dryer_logs where dryer_type = 'old' and date = '2026-11-13'
), rebuilt as (
  select rec.id,
         jsonb_agg(
           case when l.values is not null
                then (l.values - '__finalized') || '{"saved": true}'::jsonb
                else coalesce(rec.log_rows->(s.idx - 1), '{}'::jsonb)
           end
           order by s.idx) as rows
  from rec
  cross join slots s
  left join latest l on l.hour = s.hour
  group by rec.id
)
update dryer_logs d
   set log_rows = rebuilt.rows
  from rebuilt
 where d.id = rebuilt.id;

-- 2b. Recalculate Total Kg./Hour Production from the repaired rows.
update dryer_logs d
   set kg_per_hr_total = t.kg
  from (
    select id,
           sum(case when r->>'kg_per_hr' ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
                    then (r->>'kg_per_hr')::numeric end) as kg
    from dryer_logs, jsonb_array_elements(log_rows) r
    where dryer_type = 'old' and date = '2026-11-13'
    group by id
  ) t
 where d.id = t.id;

-- 2c. Recalculate the bag totals (only if migration 066 added those columns).
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'dryer_logs' and column_name = 'bags_per_hr_total') then
    update dryer_logs d
       set bags_per_hr_total    = t.b25,
           bags_per_hr_50_total = t.b_all,
           bags_50_wt_total     = t.b50,
           bags_1000_wt_total   = t.b1000
      from (
        select id,
               sum(n25)                                     as b25,
               sum(n5010)                                   as b_all,
               sum(case when size5010 = 50   then n5010 end) as b50,
               sum(case when size5010 = 1000 then n5010 end) as b1000
        from (
          select id,
                 case when r->>'bags_per_hr' ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
                      then (r->>'bags_per_hr')::numeric end    as n25,
                 case when r->>'bags_per_hr_50' ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
                      then (r->>'bags_per_hr_50')::numeric end as n5010,
                 case when r->>'bag_size_wt_50' ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
                      then (r->>'bag_size_wt_50')::numeric end as size5010
          from dryer_logs, jsonb_array_elements(log_rows) r
          where dryer_type = 'old' and date = '2026-11-13'
        ) x
        group by id
      ) t
     where d.id = t.id;
  end if;
end $$;

-- 2d. Check the result: 08:00 should now show 14 / 50.
select date, dryer_type,
       log_rows->0->>'bags_per_hr' as bags_25_0800,
       log_rows->0->>'bag_size_wt' as size_25_0800,
       log_rows->0->>'kg_per_hr'   as kg_0800,
       kg_per_hr_total
from dryer_logs
where dryer_type = 'old' and date = '2026-11-13';


-- ── UNDO (only if needed) — restore the record from the STEP 0 backup ───────
--   update dryer_logs d
--      set log_rows = b.log_rows, kg_per_hr_total = b.kg_per_hr_total
--     from dryer_logs_backup_20261113_old b
--    where d.id = b.id;
-- (with migration 066 applied, also copy bags_per_hr_total, bags_per_hr_50_total,
--  bags_50_wt_total and bags_1000_wt_total from b). When all is fine:
--   drop table dryer_logs_backup_20261113_old;
