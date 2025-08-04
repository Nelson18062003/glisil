-- Fix security issues by setting proper search paths

-- Fix generate_deposit_addresses function
CREATE OR REPLACE FUNCTION public.generate_deposit_addresses()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- In production, this would integrate with actual wallet generation services
  -- For demo purposes, we return mock addresses
  RETURN jsonb_build_object(
    'ethereum', '0x' || upper(encode(gen_random_bytes(20), 'hex')),
    'tron', 'T' || upper(encode(gen_random_bytes(21), 'hex')),
    'bsc', '0x' || upper(encode(gen_random_bytes(20), 'hex')),
    'polygon', '0x' || upper(encode(gen_random_bytes(20), 'hex')),
    'arbitrum', '0x' || upper(encode(gen_random_bytes(20), 'hex')),
    'avalanche', '0x' || upper(encode(gen_random_bytes(20), 'hex'))
  );
END;
$$;

-- Fix handle_new_wallet function
CREATE OR REPLACE FUNCTION public.handle_new_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Generate deposit addresses for new wallet
  NEW.deposit_addresses = public.generate_deposit_addresses();
  RETURN NEW;
END;
$$;