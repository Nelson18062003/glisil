import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";

export interface UserProfile {
  id: string;
  user_id: string;
  email: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  wallet_address?: string;
  kyc_status: 'pending' | 'verified' | 'rejected';
  created_at: string;
  updated_at: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  xafe_balance: number;
  usdt_balance: number;
  total_deposited: number;
  total_withdrawn: number;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: 'deposit' | 'withdrawal' | 'conversion' | 'transfer';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  from_currency?: string;
  to_currency?: string;
  from_amount?: number;
  to_amount?: number;
  exchange_rate?: number;
  fee_amount: number;
  payment_method?: string;
  external_ref?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ExchangeRate {
  id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  volume_24h: number;
  change_24h: number;
  high_24h?: number;
  low_24h?: number;
  created_at: string;
}

export class XafeService {
  static async getProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }
    
    return data as UserProfile;
  }

  static async updateProfile(userId: string, updates: Partial<UserProfile>): Promise<boolean> {
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('user_id', userId);
    
    if (error) {
      console.error('Error updating profile:', error);
      return false;
    }
    
    return true;
  }

  static async getWallet(userId: string): Promise<Wallet | null> {
    const { data, error } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (error) {
      console.error('Error fetching wallet:', error);
      return null;
    }
    
    return data as Wallet;
  }

  static async getTransactions(userId: string, limit = 10): Promise<Transaction[]> {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.error('Error fetching transactions:', error);
      return [];
    }
    
    return (data || []) as Transaction[];
  }

  static async createTransaction(transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>): Promise<string | null> {
    const { data, error } = await supabase
      .from('transactions')
      .insert(transaction)
      .select('id')
      .single();
    
    if (error) {
      console.error('Error creating transaction:', error);
      return null;
    }
    
    return data.id;
  }

  static async getExchangeRates(): Promise<ExchangeRate[]> {
    const { data, error } = await supabase
      .from('exchange_rates')
      .select('*');
    
    if (error) {
      console.error('Error fetching exchange rates:', error);
      return [];
    }
    
    return (data || []) as ExchangeRate[];
  }

  static async updateWalletBalance(
    userId: string, 
    xafeBalance?: number, 
    usdtBalance?: number
  ): Promise<boolean> {
    const updates: Partial<Wallet> = {};
    
    if (xafeBalance !== undefined) updates.xafe_balance = xafeBalance;
    if (usdtBalance !== undefined) updates.usdt_balance = usdtBalance;
    
    const { error } = await supabase
      .from('wallets')
      .update(updates)
      .eq('user_id', userId);
    
    if (error) {
      console.error('Error updating wallet balance:', error);
      return false;
    }
    
    return true;
  }

  static async simulateDeposit(userId: string, amount: number, method: string): Promise<boolean> {
    try {
      // Create transaction record
      const transactionId = await this.createTransaction({
        user_id: userId,
        type: 'deposit',
        status: 'processing',
        to_currency: 'XAF',
        to_amount: amount,
        payment_method: method,
        fee_amount: 0,
        notes: `Dépôt via ${method}`
      });

      if (!transactionId) return false;

      // Get current wallet
      const wallet = await this.getWallet(userId);
      if (!wallet) return false;

      // Update wallet balance
      const newBalance = wallet.xafe_balance + amount;
      const newTotalDeposited = wallet.total_deposited + amount;

      const { error: walletError } = await supabase
        .from('wallets')
        .update({ 
          xafe_balance: newBalance, 
          total_deposited: newTotalDeposited 
        })
        .eq('user_id', userId);

      if (walletError) {
        console.error('Error updating wallet:', walletError);
        return false;
      }

      // Update transaction status
      const { error: txError } = await supabase
        .from('transactions')
        .update({ status: 'completed' })
        .eq('id', transactionId);

      if (txError) {
        console.error('Error updating transaction:', txError);
      }

      return true;
    } catch (error) {
      console.error('Error simulating deposit:', error);
      return false;
    }
  }

  // Crypto deposit via blockchain
  static async createCryptoDeposit(network: string, amount: number): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    try {
      // Import CryptoService dynamically to avoid circular imports
      const { CryptoService } = await import('./cryptoService');
      
      // Create crypto transaction record
      await CryptoService.createDepositTransaction(network, amount);
      
      return true;
    } catch (error) {
      console.error('Error creating crypto deposit:', error);
      return false;
    }
  }

  // Crypto withdrawal via blockchain  
  static async createCryptoWithdrawal(network: string, address: string, amount: number): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    try {
      // Check sufficient balance
      const wallet = await this.getWallet(user.id);
      if (!wallet || wallet.xafe_balance < amount) {
        throw new Error('Insufficient balance');
      }

      // Import CryptoService dynamically to avoid circular imports
      const { CryptoService } = await import('./cryptoService');
      
      // Create crypto transaction record
      await CryptoService.createWithdrawalTransaction(network, address, amount);
      
      return true;
    } catch (error) {
      console.error('Error creating crypto withdrawal:', error);
      return false;
    }
  }

  static async simulateConversion(
    userId: string, 
    fromCurrency: string, 
    toCurrency: string,
    fromAmount: number,
    exchangeRate: number
  ): Promise<boolean> {
    try {
      const toAmount = fromAmount * exchangeRate;
      const feeAmount = toAmount * 0.001; // 0.1% fee
      const netAmount = toAmount - feeAmount;

      // Create transaction record
      const transactionId = await this.createTransaction({
        user_id: userId,
        type: 'conversion',
        status: 'processing',
        from_currency: fromCurrency,
        to_currency: toCurrency,
        from_amount: fromAmount,
        to_amount: netAmount,
        exchange_rate: exchangeRate,
        fee_amount: feeAmount,
        payment_method: 'Conversion rapide',
        notes: `Conversion ${fromCurrency} vers ${toCurrency}`
      });

      if (!transactionId) return false;

      // Get current wallet
      const wallet = await this.getWallet(userId);
      if (!wallet) return false;

      let updates: Partial<Wallet> = {};

      if (fromCurrency === 'XAF' && toCurrency === 'USDT') {
        // XAF to USDT
        if (wallet.xafe_balance < fromAmount) return false;
        updates.xafe_balance = wallet.xafe_balance - fromAmount;
        updates.usdt_balance = wallet.usdt_balance + (netAmount / 595.24); // Convert to USDT
      } else if (fromCurrency === 'USDT' && toCurrency === 'XAF') {
        // USDT to XAF
        if (wallet.usdt_balance < (fromAmount / 595.24)) return false;
        updates.usdt_balance = wallet.usdt_balance - (fromAmount / 595.24);
        updates.xafe_balance = wallet.xafe_balance + netAmount;
      }

      const { error: walletError } = await supabase
        .from('wallets')
        .update(updates)
        .eq('user_id', userId);

      if (walletError) {
        console.error('Error updating wallet:', walletError);
        return false;
      }

      // Update transaction status
      const { error: txError } = await supabase
        .from('transactions')
        .update({ status: 'completed' })
        .eq('id', transactionId);

      if (txError) {
        console.error('Error updating transaction:', txError);
      }

      return true;
    } catch (error) {
      console.error('Error simulating conversion:', error);
      return false;
    }
  }
}