-- ════════════════════════════════════════════════════════════
-- MIGRATION 017 — Seed all employees
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Fixes from original query:
--   1. Removed trailing comma after last row
--   2. Phone numbers stored without spaces (E.164 format)
--   3. sections use short keys that match App.jsx ALL_TABS
--      quality | dryer | batch | slurry | thermopack | all
-- ════════════════════════════════════════════════════════════

INSERT INTO public.app_users (phone, name, role, sections, is_active)
VALUES
  ('+919209298250', 'Chavan Janardan Pundalik',   'Chemist',             '["quality"]'::jsonb,     true),
  ('+919921834683', 'Shinde Bhima Ganpat',        'Chemist',             '["quality"]'::jsonb,     true),
  ('+919763895023', 'Shirsath Durgesh Jitendra',  'Chemist',             '["quality"]'::jsonb,     true),
  ('+918806344546', 'Gajbe Prabuddha Damodar',    'Dryer Operator',      '["dryer"]'::jsonb,       true),
  ('+917499952585', 'Shingh Ramprasad',           'Dryer Operator',      '["dryer"]'::jsonb,       true),
  ('+918805402369', 'Bare Sagar',                 'Dryer Operator',      '["dryer"]'::jsonb,       true),
  ('+918459273327', 'Pingle Rushikesh Devidas',   'Dryer Operator',      '["dryer"]'::jsonb,       true),
  ('+919767572550', 'Bagul Tushar Ashok',         'Slurry Production',   '["batch"]'::jsonb,       true),
  ('+918830331070', 'Patalpure Hemant Jagannath', 'Slurry Production',   '["batch"]'::jsonb,       true),
  ('+918087133065', 'Chaure Dinesh',              'Slurry Operator',     '["slurry"]'::jsonb,      true),
  ('+919762939126', 'Memane Sakharam',            'Slurry Operator',     '["slurry"]'::jsonb,      true),
  ('+917900168519', 'Yadav Arvind',               'Thermopack Operator', '["thermopack"]'::jsonb,  true),
  ('+918864075447', 'Manzi Anil',                 'Thermopack Operator', '["thermopack"]'::jsonb,  true),
  ('+919930660536', 'Admin',                      'admin',               '["all"]'::jsonb,          true),
  ('+918005011222', 'Rajesh Pandey',              'admin',               '["all"]'::jsonb,          true)
ON CONFLICT (phone) DO UPDATE
SET
  name      = EXCLUDED.name,
  role      = EXCLUDED.role,
  sections  = EXCLUDED.sections,
  is_active = EXCLUDED.is_active;


-- ── Verify ───────────────────────────────────────────────────
SELECT phone, name, role, sections, is_active
FROM public.app_users
ORDER BY role, name;
