-- ════════════════════════════════════════════════════════════
-- TABLE: slurry_operator_job_cards
-- ════════════════════════════════════════════════════════════

drop table if exists slurry_operator_job_cards cascade;

create table slurry_operator_job_cards (

  id                 uuid default gen_random_uuid() primary key,

  created_at         timestamptz default now(),

  date               date,

  shift1_operator    text,

  shift2_operator    text,

  mills              jsonb,
  -- [
  --   {
  --     mill,
  --     flow_rates[],
  --     current_amp,
  --     zirconia_beads,
  --     remarks
  --   }
  -- ]

  operator           text,

  supervisor         text,

  manager            text

);


-- ════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════

alter table slurry_operator_job_cards
enable row level security;


-- INSERT POLICY

create policy "anon_insert_slurry_operator_jc"
on slurry_operator_job_cards
for insert
to anon
with check (true);


-- SELECT POLICY

create policy "anon_select_slurry_operator_jc"
on slurry_operator_job_cards
for select
to anon
using (true);



-- ════════════════════════════════════════════════════════════
-- TABLE: slurry_operator_motor_amp
-- Running Motor Amp Status for Slurry Operator
-- ════════════════════════════════════════════════════════════

drop table if exists slurry_operator_motor_amp cascade;

create table slurry_operator_motor_amp (

  id             uuid default gen_random_uuid() primary key,

  created_at     timestamptz default now(),

  running_date   date not null,

  checked_by     text,

  remark         text,

  motor_data     jsonb
  -- [
  --   {
  --     amp,
  --     stop,
  --     timestamp,
  --     saved
  --   }
  -- ]

);


-- ════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════

alter table slurry_operator_motor_amp
enable row level security;


-- INSERT POLICY

create policy "anon_insert_slurry_operator_motor"
on slurry_operator_motor_amp
for insert
to anon
with check (true);


-- SELECT POLICY

create policy "anon_select_slurry_operator_motor"
on slurry_operator_motor_amp
for select
to anon
using (true);