-- ════════════════════════════════════════════════════════════
-- MIGRATION 016 — Add Yash & Avinash as admins
--                 Fix Chemist blank screen (wrong sections key)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════


-- ── 1. Add Yash as admin ─────────────────────────────────────
INSERT INTO public.app_users (phone, name, role, sections, is_active)
VALUES ('+918879971997', 'Yash', 'admin', '["all"]'::jsonb, true)
ON CONFLICT (phone) DO UPDATE
SET name = 'Yash', role = 'admin', sections = '["all"]'::jsonb, is_active = true;


-- ── 2. Add Avinash as admin ──────────────────────────────────
INSERT INTO public.app_users (phone, name, role, sections, is_active)
VALUES ('+919766717490', 'Avinash', 'admin', '["all"]'::jsonb, true)
ON CONFLICT (phone) DO UPDATE
SET name = 'Avinash', role = 'admin', sections = '["all"]'::jsonb, is_active = true;


-- ── 3. Fix Chemist blank screen ──────────────────────────────
-- The sections value was '["Quality Control"]' (the tab label).
-- App.jsx maps against the short key "quality", not the label.
-- Correct value: '["quality"]'
UPDATE public.app_users
SET sections = '["quality"]'::jsonb
WHERE phone = '+919209298250'
  AND role  = 'Chemist';


-- ── 4. Verify all three rows ─────────────────────────────────
SELECT phone, name, role, sections, is_active
FROM public.app_users
WHERE phone IN ('+918879971997', '+919766717490', '+919209298250')
ORDER BY name;
