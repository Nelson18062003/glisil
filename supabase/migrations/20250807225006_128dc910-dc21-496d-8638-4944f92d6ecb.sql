-- Bootstrap admin utilities

-- Function: admin_exists()
CREATE OR REPLACE FUNCTION public.admin_exists()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE role = 'admin' LIMIT 1
  );
$$;

-- Function: bootstrap_admin() – allows first authenticated user to self-assign admin if none exists
CREATE OR REPLACE FUNCTION public.bootstrap_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  exists_admin boolean;
BEGIN
  SELECT public.admin_exists() INTO exists_admin;
  IF exists_admin THEN
    RETURN false; -- Already initialized
  END IF;

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (current_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN true;
END;
$$;

-- Optional: grant_role() for future admin management
CREATE OR REPLACE FUNCTION public.grant_role(target_user uuid, target_role public.app_role)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF NOT public.has_role(caller, 'admin') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user, target_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN true;
END;
$$;