-- ====================================================================
-- STEP SOLVER - SINGLE-DEVICE ACTIVE LOCK & 2-DEVICE LIMIT ENFORCEMENT
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

-- 3. Atomic Function: get_user_profile
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

-- 4. Atomic Function: check_and_register_device
-- ENFORCES:
--   a) Strictly 1 ACTIVE device at a time (current_device_id). Simultaneous access blocked!
--   b) Maximum 2 distinct REGISTERED devices allowed. 3rd device triggers 24-hour ban!
CREATE OR REPLACE FUNCTION public.check_and_register_device(
  p_user_id uuid,
  p_device_id text,
  p_device_info text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile record;
  v_registered_count int;
  v_registered_devices text[];
  v_is_registered boolean;
  v_ban_duration interval := interval '1 day';
  v_banned_until timestamptz;
BEGIN
  -- 1. Lock profile row for atomic concurrency inspection
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found');
  END IF;

  -- 2. Check active ban status
  IF v_profile.banned_until IS NOT NULL THEN
    IF v_profile.banned_until > now() THEN
      RETURN jsonb_build_object(
        'is_banned', true,
        'banned_until', v_profile.banned_until,
        'ban_reason', v_profile.ban_reason,
        'allowed', false,
        'is_device_active', false
      );
    ELSE
      -- Ban duration elapsed; automatically lift ban
      UPDATE public.profiles 
      SET banned_until = NULL, ban_reason = NULL 
      WHERE id = p_user_id;
    END IF;
  END IF;

  -- 3. Check registered distinct devices for this user (limit <= 2)
  SELECT 
    count(*), 
    coalesce(array_agg(device_id), '{}'),
    bool_or(device_id = p_device_id)
  INTO 
    v_registered_count, 
    v_registered_devices, 
    v_is_registered
  FROM public.device_sessions
  WHERE user_id = p_user_id AND is_active = true;

  -- If this device is not yet in the active registered devices list:
  IF NOT coalesce(v_is_registered, false) THEN
    -- Check if registered devices already reached limit (2 devices)
    IF v_registered_count >= coalesce(v_profile.max_allowed_devices, 2) THEN
      -- MULTI-DEVICE VIOLATION (> 2 devices detected): 3rd device attempt -> 1-DAY BAN!
      v_banned_until := now() + v_ban_duration;

      UPDATE public.profiles
      SET 
        banned_until = v_banned_until,
        ban_reason = format('Multi-device violation: Attempted 3rd device access (%s) with registered devices: %s', p_device_id, array_to_string(v_registered_devices, ', ')),
        ban_count = coalesce(ban_count, 0) + 1,
        current_device_id = NULL
      WHERE id = p_user_id;

      -- Deactivate all device sessions
      UPDATE public.device_sessions
      SET is_active = false, deactivated_at = now()
      WHERE user_id = p_user_id;

      -- Record audit log
      INSERT INTO public.user_ban_logs (user_id, banned_until, reason, violating_device_id, violating_device_info, active_device_ids)
      VALUES (p_user_id, v_banned_until, 'Multi-device violation (> 2 devices)', p_device_id, p_device_info, v_registered_devices);

      RETURN jsonb_build_object(
        'is_banned', true,
        'banned_until', v_banned_until,
        'ban_reason', 'Multi-device violation: More than 2 devices detected on this account.',
        'allowed', false,
        'is_device_active', false,
        'registered_count', v_registered_count + 1,
        'max_devices', coalesce(v_profile.max_allowed_devices, 2)
      );
    ELSE
      -- New device within 2-device allowance: Register it into device_sessions
      INSERT INTO public.device_sessions (user_id, device_id, device_info, is_active, last_active_at)
      VALUES (p_user_id, p_device_id, p_device_info, true, now())
      ON CONFLICT (user_id, device_id)
      DO UPDATE SET is_active = true, last_active_at = now(), device_info = EXCLUDED.device_info;

      v_registered_count := v_registered_count + 1;
      v_is_registered := true;
    END IF;
  ELSE
    -- Device already registered: Update last_active_at and device_info
    UPDATE public.device_sessions 
    SET last_active_at = now(), device_info = coalesce(p_device_info, device_info)
    WHERE user_id = p_user_id AND device_id = p_device_id;
  END IF;

  -- 4. STRICT SINGLE-DEVICE ACTIVE CONCURRENCY LOCK:
  -- Only ONE device can be actively solving / active at any time!
  -- Case A: No device is currently active -> this device claims active lock
  IF v_profile.current_device_id IS NULL THEN
    UPDATE public.profiles
    SET current_device_id = p_device_id, last_device_name = p_device_info, last_active_at = now()
    WHERE id = p_user_id;

    RETURN jsonb_build_object(
      'is_banned', false,
      'allowed', true,
      'is_device_active', true,
      'active_device_id', p_device_id,
      'registered_count', v_registered_count,
      'max_devices', coalesce(v_profile.max_allowed_devices, 2)
    );
  END IF;

  -- Case B: This device is already the active device
  IF v_profile.current_device_id = p_device_id THEN
    UPDATE public.profiles
    SET last_device_name = coalesce(p_device_info, last_device_name), last_active_at = now()
    WHERE id = p_user_id;

    RETURN jsonb_build_object(
      'is_banned', false,
      'allowed', true,
      'is_device_active', true,
      'active_device_id', p_device_id,
      'registered_count', v_registered_count,
      'max_devices', coalesce(v_profile.max_allowed_devices, 2)
    );
  END IF;

  -- Case C: CONFLICT! Another device is currently active!
  -- SIMULTANEOUS ACCESS IS STRICTLY BLOCKED!
  RETURN jsonb_build_object(
    'is_banned', false,
    'allowed', false,
    'is_device_active', false,
    'conflict_device_id', v_profile.current_device_id,
    'conflict_device_name', coalesce(v_profile.last_device_name, 'Another Device'),
    'registered_count', v_registered_count,
    'max_devices', coalesce(v_profile.max_allowed_devices, 2)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_register_device(uuid, text, text) TO anon, authenticated, service_role;

-- 5. Atomic Function: claim_device
-- Allows user to switch active access to this device (revoking the other device)
CREATE OR REPLACE FUNCTION public.claim_device(
  p_user_id uuid,
  p_device_id text,
  p_device_info text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile record;
  v_registered_count int;
  v_registered_devices text[];
  v_is_registered boolean;
  v_ban_duration interval := interval '1 day';
  v_banned_until timestamptz;
BEGIN
  -- 1. Lock profile row
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found');
  END IF;

  -- 2. Check ban
  IF v_profile.banned_until IS NOT NULL AND v_profile.banned_until > now() THEN
    RETURN jsonb_build_object('success', false, 'is_banned', true, 'banned_until', v_profile.banned_until);
  END IF;

  -- 3. Check registered devices limit
  SELECT 
    count(*), 
    coalesce(array_agg(device_id), '{}'),
    bool_or(device_id = p_device_id)
  INTO 
    v_registered_count, 
    v_registered_devices, 
    v_is_registered
  FROM public.device_sessions
  WHERE user_id = p_user_id AND is_active = true;

  IF NOT coalesce(v_is_registered, false) THEN
    IF v_registered_count >= coalesce(v_profile.max_allowed_devices, 2) THEN
      -- 3rd device violation!
      v_banned_until := now() + v_ban_duration;
      UPDATE public.profiles
      SET banned_until = v_banned_until, ban_reason = 'Multi-device violation (> 2 devices)', current_device_id = NULL
      WHERE id = p_user_id;
      UPDATE public.device_sessions SET is_active = false, deactivated_at = now() WHERE user_id = p_user_id;
      RETURN jsonb_build_object('success', false, 'is_banned', true, 'banned_until', v_banned_until);
    ELSE
      INSERT INTO public.device_sessions (user_id, device_id, device_info, is_active, last_active_at)
      VALUES (p_user_id, p_device_id, p_device_info, true, now())
      ON CONFLICT (user_id, device_id) DO UPDATE SET is_active = true, last_active_at = now();
    END IF;
  END IF;

  -- 4. Take over as the ONLY active device!
  UPDATE public.profiles
  SET current_device_id = p_device_id, last_device_name = p_device_info, last_active_at = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'is_device_active', true,
    'active_device_id', p_device_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_device(uuid, text, text) TO anon, authenticated, service_role;

-- 6. Atomic Function: check_email_verified
-- Allows extension to query whether user has completed email confirmation
CREATE OR REPLACE FUNCTION public.check_email_verified(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_confirmed timestamptz;
  v_user_exists boolean;
BEGIN
  SELECT email_confirmed_at, true
  INTO v_confirmed, v_user_exists
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;

  IF NOT coalesce(v_user_exists, false) THEN
    RETURN jsonb_build_object('exists', false, 'verified', false);
  END IF;

  RETURN jsonb_build_object(
    'exists', true, 
    'verified', (v_confirmed IS NOT NULL),
    'confirmed_at', v_confirmed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_email_verified(text) TO anon, authenticated, service_role;

-- 7. Guarantee Lifetime PRO access for paid users
UPDATE public.profiles 
SET payment_status = 'paid', paid_at = coalesce(paid_at, now())
WHERE email IN (
  'vicky636501@gmail.com',
  'vishaldcp614@gmail.com',
  'vishaludayakumar2@gmail.com',
  'yogesh701042@gmail.com',
  'joevishwa639@gmail.com',
  'mvenkateshvenkat272@gmail.com',
  'support.vickydevsolutions@gmail.com'
);

-- 7. Verification: Return paid profiles and row count
SELECT email, payment_status, current_device_id, last_device_name 
FROM public.profiles 
ORDER BY payment_status DESC, email ASC;
