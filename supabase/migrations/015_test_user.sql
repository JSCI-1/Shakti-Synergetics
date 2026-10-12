-- ════════════════════════════════════════════════════════════
-- TEST USER — Role Switcher
-- Change ONLY the role value below, then Run.
--
-- Available roles:
--   admin
--   Chemist
--   Dryer Operator
--   Slurry Production
--   Slurry Operator
--   Thermopack Operator
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_role text := 'admin';   -- ← CHANGE ONLY THIS LINE
BEGIN
    UPDATE public.app_users
    SET
        role     = v_role,
        sections = CASE v_role
                       WHEN 'Chemist'             THEN '["quality"]'::jsonb
                       WHEN 'Dryer Operator'       THEN '["dryer"]'::jsonb
                       WHEN 'Slurry Production'    THEN '["batch"]'::jsonb
                       WHEN 'Slurry Operator'      THEN '["slurry"]'::jsonb
                       WHEN 'Thermopack Operator'  THEN '["thermopack"]'::jsonb
                       ELSE '["all"]'::jsonb
                   END
    WHERE phone = '+919076424559';

    RAISE NOTICE 'Test user role switched to: %', v_role;
END $$;
