-- ====================================================================
-- STEP SOLVER - STANDALONE PROFILE RESTORE & PRO ACCESS SCRIPT
-- Paste and run directly in Supabase SQL Editor
-- ====================================================================

-- 1. Ensure public.profiles table exists with all required columns
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text,
  payment_status text DEFAULT 'unpaid',
  amount_paid_inr numeric DEFAULT 0,
  paid_at timestamptz DEFAULT NULL,
  trial_started_at timestamptz DEFAULT NULL,
  current_device_id text DEFAULT NULL,
  last_device_name text DEFAULT NULL,
  last_active_at timestamptz DEFAULT now(),
  banned_until timestamptz DEFAULT NULL,
  ban_reason text DEFAULT NULL,
  ban_count int DEFAULT 0,
  max_allowed_devices int DEFAULT 2,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Disable Row Level Security on profiles so extension and table editor can always view/query
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.profiles TO anon, authenticated, service_role;

-- 3. Auto-populate any registered auth.users into public.profiles if missing
INSERT INTO public.profiles (id, email, full_name, payment_status, max_allowed_devices, created_at, updated_at)
SELECT 
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  'unpaid',
  2,
  u.created_at,
  now()
FROM auth.users u
ON CONFLICT (id) DO UPDATE 
SET email = EXCLUDED.email;

-- 4. Restore exact profile data and trial timestamps for all existing users
INSERT INTO public.profiles (id, email, full_name, payment_status, trial_started_at, current_device_id, last_device_name, last_active_at, max_allowed_devices)
VALUES
  ('36301eb1-d814-4fb5-a4a7-e0bb370cf3b2', 'mvenkateshvenkat272@gmail.com', 'venkatesh', 'paid', '2026-09-26T04:21:48.194+00:00', 'dev_867py7t2_mugiu0i2', 'Windows PC (Edge)', '2026-09-26T04:22:32.088+00:00', 2),
  ('96999d83-5644-4a6d-9ebf-9c6ae8f44daa', 'medhinesh0510@gmail.com', 'Dhinesh', 'unpaid', '2026-09-24T06:12:08.042+00:00', 'dev_x94hrsnj_muf4wxrd', 'Windows PC (Edge)', '2026-09-24T06:13:12.722+00:00', 2),
  ('0f8ad2b0-876f-49fc-8c17-2f811784a5ca', 'rajamanickamsankar40@gmail.com', 'SANKAR R R', 'unpaid', '2026-09-25T14:36:16.343+00:00', 'dev_a9vctq1o_muh2d45v', 'Windows PC (Edge)', '2026-09-25T14:37:04.279+00:00', 2),
  ('6b2fafea-e03e-42a8-9806-2d70e2d0e98b', 'umarfarook3289@gmail.com', 'Umar Farook', 'unpaid', '2026-09-28T04:38:17.475+00:00', 'dev_94uh6mdc_muhvkbhd', 'Windows PC (Edge)', '2026-09-28T04:41:25.566+00:00', 2),
  ('05ba1371-34f6-4358-abf1-e52526dd0af4', 'ramsitha675@gmail.com', 'Jey', 'unpaid', '2026-09-27T01:51:37.213+00:00', 'dev_s8m1zg8i_muj5rpvw', 'Linux PC (Chrome)', '2026-09-27T01:52:38.903+00:00', 2),
  ('d1d04ead-c408-4920-82e2-20c6e6dbd342', 'sanjay2024cse@gmail.com', 'sanjay', 'unpaid', '2026-09-25T08:51:45.016+00:00', 'dev_tk0s9tzh_mugq222f', 'Windows PC (Edge)', '2026-09-25T08:52:20.417+00:00', 2),
  ('74cff802-b9b2-4a3d-80df-d681e6dae16d', 'munivelraj007@gmail.com', 'Munivel', 'unpaid', '2026-09-27T14:48:26.03+00:00', 'dev_c9unwwcm_mujxogii', 'Windows PC (Edge)', '2026-09-27T14:49:30.755+00:00', 2),
  ('bcdfad75-cb6b-47af-acaf-f9128a2bbe7c', 'rgopinathrgopinath000@gmail.com', 'hi', 'unpaid', '2026-09-25T10:12:28.468+00:00', 'dev_se8uj8yw_mugsxvak', 'Windows PC (Edge)', '2026-09-25T10:13:05.586+00:00', 2),
  ('85406774-2e4f-4e7d-afed-0effd9fb6fcd', 'kingkavin068@gmail.com', 'Kavin', 'unpaid', '2026-09-24T04:14:54.425+00:00', NULL, 'Linux PC (Chrome)', '2026-09-24T04:16:09.669+00:00', 2),
  ('d6e3d765-0ecd-4305-ada5-495949eed98f', 'subeeshpersonal497@gmail.com', 'Subeeshkanth', 'unpaid', '2026-09-30T03:03:07.231+00:00', 'dev_6h8szq3a_muexm3xp', 'Linux PC (Chrome)', '2026-09-30T03:03:11.327+00:00', 2),
  ('5770a4f4-9bff-44c1-ac45-48bb661f0427', 'saravananambi2007@gmail.com', 'Saravananambi', 'unpaid', '2026-09-24T03:58:54.48+00:00', 'dev_nltkssjj_muf03zak', 'Linux PC (Chrome)', '2026-09-24T03:59:22.339+00:00', 2),
  ('942b34a8-f19d-4a8b-814b-164cad1e4c60', 'ky909417@gmail.com', 'K4v1', 'unpaid', '2026-09-24T05:17:03.265+00:00', 'dev_yrs2hhjh_muf2y3ru', 'Linux PC (Chrome)', '2026-09-24T15:40:37.415+00:00', 2),
  ('7ca94b19-479a-4457-9856-559146dc988b', 'zhnolusi@gmail.com', 'tharani', 'unpaid', '2026-09-25T14:08:42.048+00:00', 'dev_lylkl1qh_muh1dnpb', 'Windows PC (Edge)', '2026-09-25T14:11:32.044+00:00', 2),
  ('6d6fb8cf-1bf7-41a0-8613-463bfa21e83b', 'venkatselvi0001@gmail.com', 'vengatesh', 'unpaid', '2026-09-28T10:00:03.241+00:00', 'dev_trfpzubt_mul2tg9z', 'Windows PC (Edge)', '2026-09-28T10:00:51.372+00:00', 2),
  ('ee64f2c5-b7bd-4dd2-b890-754ffccc761d', 'joevishwa639@gmail.com', 'vishwa', 'paid', '2026-09-24T06:13:00.226+00:00', 'dev_sw9nfmts_mul9konq', 'Windows PC (Edge)', '2026-09-28T13:09:11.512+00:00', 2),
  ('2830710c-1d61-4add-978c-ebeb46c2e4fd', 'tamilganesh704@gmail.com', 'Tamil', 'unpaid', '2026-09-29T04:11:58.648+00:00', 'dev_pex0l4da_mum5toa6', 'Linux PC (Chrome)', '2026-09-29T04:12:28.706+00:00', 2),
  ('8bf37f22-02e0-4e8a-84a5-a4367843b316', 'yogesh701042@gmail.com', 'Yogesh', 'paid', '2026-09-29T02:39:59.157+00:00', 'dev_5tya2o2v_mum2jdf3', 'Windows PC (Edge)', '2026-09-30T06:55:13.246+00:00', 2),
  ('44e2e3d8-4e9b-4129-82cd-0fc765986e38', 'vishaludayakumar2@gmail.com', 'Vishal', 'paid', '2026-09-29T07:15:51.026+00:00', 'dev_y22ci7o4_munwej9h', 'Linux PC (Chrome)', '2026-09-30T09:23:48.103+00:00', 2),
  ('5ba0f141-251e-4738-8a6e-beb8a8251bb4', 'yy4095030@gmail.com', 'yogi', 'unpaid', '2026-09-29T08:21:46.73+00:00', 'dev_5tya2o2v_mum2jdf3', 'Windows PC (Edge)', '2026-09-29T08:21:50.211+00:00', 2),
  ('fae4420f-aaf0-4bc0-84c9-235bc5b4eef5', 'venkatmvenkatesh222@gmail.com', 'venkatesh', 'unpaid', '2026-09-26T04:19:41.439+00:00', 'dev_867py7t2_mugiu0i2', 'Windows PC (Edge)', '2026-09-26T04:19:45.983+00:00', 2),
  ('5ebc5ff1-7dca-47e9-a3c4-1f8c1e19f99a', 'vtddcy@gmail.com', 'vt', 'unpaid', '2026-10-02T01:41:49.945+00:00', NULL, 'Windows PC (Edge)', '2026-10-02T03:17:56.86+00:00', 2),
  ('e7600431-ebc1-488d-ad4a-86699098f32f', 'vishaldcp614@gmail.com', 'Vishal T', 'paid', '2026-10-02T01:41:49.945+00:00', 'dev_kiaueuxm_muqasufp', 'Windows PC (Edge)', '2026-10-02T03:26:36.928+00:00', 2),
  ('c2fa0fb2-fd5e-4e4d-b91d-dbec638fbd1f', 'harikrishna02.11.2006@gmail.com', 'krizzna', 'unpaid', '2026-09-26T04:26:09.456+00:00', 'dev_wu6ou7zr_muhw0crv', 'Windows PC (Edge)', '2026-09-26T04:26:48.424+00:00', 2),
  ('99c5ef19-7395-46d6-977a-66e54590d250', 'vicky.fullstackdevpro@gmail.com', 'vicky', 'unpaid', '2026-09-13T04:54:50.34+00:00', 'dev_6vhdk823_mufoyf9o', 'Windows PC (Edge)', '2026-10-02T10:46:19.939+00:00', 2),
  ('ed893a25-9d00-4f22-8c6d-4754183fe8c3', 'vicky636501@gmail.com', 'vicky', 'paid', '2026-09-13T04:54:50.340487+00:00', NULL, 'Windows PC (Chrome)', '2026-10-01T16:05:56.665+00:00', 2),
  ('bd4e9a72-fe0f-4a9d-89d2-f5d49c8fb7d9', 'sanjaymasscanjay@gmail.com', 'SANJAY RAJ', 'unpaid', '2026-09-25T14:56:25.763+00:00', 'device_r5gup5dyyb_mty5pnc3', 'Windows PC (Chrome)', '2026-10-02T11:17:48.61+00:00', 2)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = coalesce(EXCLUDED.full_name, public.profiles.full_name),
  payment_status = EXCLUDED.payment_status,
  trial_started_at = coalesce(public.profiles.trial_started_at, EXCLUDED.trial_started_at),
  max_allowed_devices = coalesce(public.profiles.max_allowed_devices, 2);

-- 5. Authoritatively guarantee Lifetime PRO access for all paid users
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

-- 6. Verify restored status
SELECT email, payment_status, max_allowed_devices, created_at 
FROM public.profiles 
ORDER BY payment_status DESC, email ASC;
