-- Fix function search path security warning
CREATE OR REPLACE FUNCTION public.generate_mint_reference()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN 'XAFE-MINT-' || LPAD(floor(random() * 100000)::text, 5, '0');
END;
$$;