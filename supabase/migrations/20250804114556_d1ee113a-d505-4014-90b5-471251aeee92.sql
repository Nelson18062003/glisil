-- Add wallet addresses for different blockchain networks
ALTER TABLE public.wallets 
ADD COLUMN IF NOT EXISTS deposit_addresses JSONB DEFAULT '{}'::jsonb;

-- Add comment to explain the structure
COMMENT ON COLUMN public.wallets.deposit_addresses IS 'JSON object containing deposit addresses for different networks: {"ethereum": "0x...", "tron": "T...", "bsc": "0x..."}';

-- Add network support to transactions table
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS network TEXT,
ADD COLUMN IF NOT EXISTS transaction_hash TEXT,
ADD COLUMN IF NOT EXISTS wallet_address TEXT;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_transactions_network ON public.transactions(network);
CREATE INDEX IF NOT EXISTS idx_transactions_hash ON public.transactions(transaction_hash);

-- Create a function to generate deposit addresses (mock for demo)
CREATE OR REPLACE FUNCTION public.generate_deposit_addresses()
RETURNS JSONB
LANGUAGE plpgsql
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

-- Update existing wallets to have deposit addresses
UPDATE public.wallets 
SET deposit_addresses = public.generate_deposit_addresses()
WHERE deposit_addresses = '{}'::jsonb OR deposit_addresses IS NULL;

-- Create trigger to generate addresses for new wallets
CREATE OR REPLACE FUNCTION public.handle_new_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Generate deposit addresses for new wallet
  NEW.deposit_addresses = public.generate_deposit_addresses();
  RETURN NEW;
END;
$$;

-- Create trigger for new wallets
DROP TRIGGER IF EXISTS trigger_generate_wallet_addresses ON public.wallets;
CREATE TRIGGER trigger_generate_wallet_addresses
  BEFORE INSERT ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_wallet();