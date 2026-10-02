-- ====================================================================
-- STEP SOLVER - FIX RLS PERMISSIONS & PRO PROFILE ACCESS
-- Paste and run this script directly in the Supabase SQL Editor.
-- ====================================================================

-- 1. Ensure permissions are fully granted to anon and authenticated roles
GRANT ALL ON TABLE public.profiles TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.device_sessions TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.user_ban_logs TO anon, authenticated, service_role;

-- 2. Configure Row Level Security with permissive policies so queries never return empty
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations for profiles" ON public.profiles;
CREATE POLICY "Allow all operations for profiles" 
  ON public.profiles 
  FOR ALL 
  TO anon, authenticated, service_role 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations for device_sessions" ON public.device_sessions;
CREATE POLICY "Allow all operations for device_sessions" 
  ON public.device_sessions 
  FOR ALL 
  TO anon, authenticated, service_role 
  USING (true) 
  WITH CHECK (true);

-- 3. Create Atomic SECURITY DEFINER Function to get profile bypassing any RLS restrictions
CREATE OR REPLACE FUNCTION public.get_user_profile(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile record;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN to_jsonb(v_profile);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_profile(uuid) TO anon, authenticated, service_role;

-- 4. Authoritatively guarantee Lifetime PRO access for all paid users
UPDATE public.profiles 
SET payment_status = 'paid', paid_at = coalesce(paid_at, now())
WHERE email IN (
  'vicky636501@gmail.com',
  'vishaldcp614@gmail.com',
  'vishaludayakumar2@gmail.com',
  'yogesh701042@gmail.com',
  'joevishwa639@gmail.com',
  'mvenkateshvenkat272@gmail.com'
);

-- 5. Verification: Return paid profiles and row count
SELECT email, payment_status, trial_started_at, max_allowed_devices 
FROM public.profiles 
ORDER BY payment_status DESC, email ASC;
