-- ====================================================================
-- STEP SOLVER - MULTI-DEVICE (>2) DETECTION & 1-DAY BAN ENFORCEMENT
-- Database Migration Script for Supabase (PostgreSQL)
-- ====================================================================

-- 1. Update public.profiles table with ban and device configuration fields
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS banned_until timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ban_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ban_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_allowed_devices int DEFAULT 2;

-- 2. Update public.device_sessions table for auditing and tracking
ALTER TABLE public.device_sessions 
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz DEFAULT NULL;

-- Index for instant concurrent device counting
CREATE INDEX IF NOT EXISTS idx_device_sessions_user_active 
  ON public.device_sessions (user_id, is_active);

-- 3. Create public.user_ban_logs audit table
CREATE TABLE IF NOT EXISTS public.user_ban_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  banned_at timestamptz DEFAULT now(),
  banned_until timestamptz NOT NULL,
  reason text NOT NULL,
  violating_device_id text NOT NULL,
  violating_device_info text,
  active_device_ids text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on audit table
ALTER TABLE public.user_ban_logs ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'user_ban_logs' AND policyname = 'Users can view own ban logs'
  ) THEN
    CREATE POLICY "Users can view own ban logs" ON public.user_ban_logs
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

-- 4. Atomic Stored Procedure: Device Registration, Count & Ban Trigger
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
  v_active_count int;
  v_active_devices text[];
  v_is_already_active boolean;
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
        'allowed', false
      );
    ELSE
      -- Ban duration elapsed; automatically lift ban
      UPDATE public.profiles 
      SET banned_until = NULL, ban_reason = NULL 
      WHERE id = p_user_id;
    END IF;
  END IF;

  -- 3. Inspect active devices for this user
  SELECT 
    count(*), 
    coalesce(array_agg(device_id), '{}'),
    bool_or(device_id = p_device_id)
  INTO 
    v_active_count, 
    v_active_devices, 
    v_is_already_active
  FROM public.device_sessions
  WHERE user_id = p_user_id AND is_active = true;

  -- Case A: This device is already one of the active registered devices
  IF v_is_already_active THEN
    UPDATE public.device_sessions 
    SET last_active_at = now(), device_info = coalesce(p_device_info, device_info)
    WHERE user_id = p_user_id AND device_id = p_device_id;

    RETURN jsonb_build_object(
      'is_banned', false,
      'allowed', true,
      'active_count', v_active_count,
      'max_devices', coalesce(v_profile.max_allowed_devices, 2),
      'active_devices', v_active_devices
    );
  END IF;

  -- Case B: New device, and active device count is strictly within allowance (< 2)
  IF v_active_count < coalesce(v_profile.max_allowed_devices, 2) THEN
    INSERT INTO public.device_sessions (user_id, device_id, device_info, is_active, last_active_at)
    VALUES (p_user_id, p_device_id, p_device_info, true, now())
    ON CONFLICT (user_id, device_id) 
    DO UPDATE SET is_active = true, last_active_at = now(), device_info = EXCLUDED.device_info;

    RETURN jsonb_build_object(
      'is_banned', false,
      'allowed', true,
      'active_count', v_active_count + 1,
      'max_devices', coalesce(v_profile.max_allowed_devices, 2)
    );
  END IF;

  -- Case C: MULTI-DEVICE VIOLATION (> 2 devices detected)
  -- 2 devices are already active, and a 3rd distinct device attempted access
  v_banned_until := now() + v_ban_duration;

  UPDATE public.profiles
  SET 
    banned_until = v_banned_until,
    ban_reason = format('Multi-device violation: Attempted 3rd device access (%s) with active devices: %s', p_device_id, array_to_string(v_active_devices, ', ')),
    ban_count = coalesce(ban_count, 0) + 1
  WHERE id = p_user_id;

  -- Deactivate all device sessions
  UPDATE public.device_sessions
  SET is_active = false, deactivated_at = now()
  WHERE user_id = p_user_id;

  -- Record audit log
  INSERT INTO public.user_ban_logs (user_id, banned_until, reason, violating_device_id, violating_device_info, active_device_ids)
  VALUES (p_user_id, v_banned_until, 'Multi-device violation (> 2 devices)', p_device_id, p_device_info, v_active_devices);

  RETURN jsonb_build_object(
    'is_banned', true,
    'banned_until', v_banned_until,
    'ban_reason', 'Multi-device violation: More than 2 devices detected on this account.',
    'allowed', false,
    'active_count', v_active_count + 1,
    'max_devices', coalesce(v_profile.max_allowed_devices, 2)
  );
END;
$$;
