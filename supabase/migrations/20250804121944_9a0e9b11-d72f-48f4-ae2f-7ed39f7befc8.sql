-- Create table for mint operations
CREATE TABLE public.mint_operations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  reference_id TEXT NOT NULL UNIQUE,
  xaf_amount NUMERIC NOT NULL,
  xafe_amount NUMERIC NOT NULL,
  payment_method TEXT NOT NULL,
  payment_channel TEXT NOT NULL,
  account_name TEXT,
  account_number TEXT,
  status TEXT DEFAULT 'pending',
  proof_file_url TEXT,
  notes TEXT,
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + INTERVAL '24 hours'),
  verified_at TIMESTAMP WITH TIME ZONE,
  minted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.mint_operations ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own mint operations" 
ON public.mint_operations 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own mint operations" 
ON public.mint_operations 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own mint operations" 
ON public.mint_operations 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Add trigger for timestamps
CREATE TRIGGER update_mint_operations_updated_at
BEFORE UPDATE ON public.mint_operations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to generate unique reference ID
CREATE OR REPLACE FUNCTION public.generate_mint_reference()
RETURNS TEXT AS $$
BEGIN
  RETURN 'XAFE-MINT-' || LPAD(floor(random() * 100000)::text, 5, '0');
END;
$$ LANGUAGE plpgsql;