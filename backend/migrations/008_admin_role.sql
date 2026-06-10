-- 008_admin_role.sql
-- Add a role column to profiles to distinguish admin from regular users.
-- 'user' is the default; one admin is seeded for the app owner.
--
-- Apply in Supabase SQL editor or psql against the project DB.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin'));

CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles (role);

-- Seed the app owner as the initial admin. Edit the email to match the
-- account that should hold admin rights before running on a fresh DB.
UPDATE public.profiles
  SET role = 'admin'
  WHERE user_id = (
    SELECT id FROM auth.users WHERE email = 'supersonic220019@gmail.com'
  );
