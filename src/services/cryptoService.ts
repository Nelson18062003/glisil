import { supabase } from "@/integrations/supabase/client";

export interface WalletAddress {
  id: string;
  user_id: string;
  network: string;
  address: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface CryptoTransaction {
  id: string;
  user_id: string;
  type: 'deposit' | 'withdrawal';
  network: string;
  currency: string;
  amount: number;
  wallet_address: string;
  tx_hash?: string;
  status: 'pending' | 'processing' | 'confirmed' | 'failed' | 'cancelled';
  confirmations: number;
  required_confirmations: number;
  created_at: string;
  updated_at: string;
}

export class CryptoService {
  // Generate deposit address for a specific network
  static async getDepositAddress(network: string): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Check if user already has an address for this network
    const { data: existingAddress } = await supabase
      .from('wallet_addresses')
      .select('*')
      .eq('user_id', user.id)
      .eq('network', network)
      .maybeSingle();

    if (existingAddress) {
      return existingAddress.address;
    }

    // Generate new address based on network
    const address = this.generateAddress(network, user.id);

    // Save the new address
    const { error } = await supabase
      .from('wallet_addresses')
      .insert({
        user_id: user.id,
        network,
        address,
        is_primary: true
      });

    if (error) {
      console.error('Error saving wallet address:', error);
      throw new Error('Failed to generate deposit address');
    }

    return address;
  }

  // Generate a deterministic address based on network and user ID
  private static generateAddress(network: string, userId: string): string {
    // In a real implementation, this would use proper cryptographic methods
    // For demo purposes, we'll generate deterministic addresses
    const hash = this.simpleHash(userId + network);
    
    switch (network) {
      case 'TRC20':
        return 'T' + hash.substring(0, 33);
      case 'ERC20':
      case 'BEP20':
      case 'POLYGON':
      case 'ARBITRUM':
        return '0x' + hash.substring(0, 40);
      case 'AVALANCHE':
        return '0x' + hash.substring(0, 40);
      default:
        throw new Error('Unsupported network');
    }
  }

  private static simpleHash(input: string): string {
    let hash = 0;
    const fullInput = input + 'xafe_salt_2024';
    for (let i = 0; i < fullInput.length; i++) {
      const char = fullInput.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Convert to hex and ensure proper length
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    return (hex + hex + hex + hex + hex).substring(0, 40);
  }

  // Create a deposit transaction
  static async createDepositTransaction(
    network: string, 
    amount: number
  ): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const depositAddress = await this.getDepositAddress(network);

    const { data, error } = await supabase
      .from('crypto_transactions')
      .insert({
        user_id: user.id,
        type: 'deposit',
        network,
        currency: 'XAFe',
        amount,
        wallet_address: depositAddress,
        status: 'pending',
        confirmations: 0,
        required_confirmations: this.getRequiredConfirmations(network)
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error creating deposit transaction:', error);
      throw new Error('Failed to create deposit transaction');
    }

    return data.id;
  }

  // Create a withdrawal transaction
  static async createWithdrawalTransaction(
    network: string,
    address: string,
    amount: number
  ): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('crypto_transactions')
      .insert({
        user_id: user.id,
        type: 'withdrawal',
        network,
        currency: 'XAFe',
        amount,
        wallet_address: address,
        status: 'pending',
        confirmations: 0,
        required_confirmations: this.getRequiredConfirmations(network)
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error creating withdrawal transaction:', error);
      throw new Error('Failed to create withdrawal transaction');
    }

    return data.id;
  }

  // Get recent deposits
  static async getRecentDeposits(): Promise<CryptoTransaction[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('crypto_transactions')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', 'deposit')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Error fetching recent deposits:', error);
      return [];
    }

    return (data || []) as CryptoTransaction[];
  }

  // Get recent withdrawals
  static async getRecentWithdrawals(): Promise<CryptoTransaction[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('crypto_transactions')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', 'withdrawal')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Error fetching recent withdrawals:', error);
      return [];
    }

    return (data || []) as CryptoTransaction[];
  }

  // Get user's wallet addresses
  static async getUserWalletAddresses(): Promise<WalletAddress[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('wallet_addresses')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching wallet addresses:', error);
      return [];
    }

    return (data || []) as WalletAddress[];
  }

  // Get required confirmations for network
  private static getRequiredConfirmations(network: string): number {
    const confirmations = {
      'TRC20': 19,
      'ERC20': 12,
      'BEP20': 15,
      'POLYGON': 30,
      'ARBITRUM': 12,
      'AVALANCHE': 12
    };
    return confirmations[network as keyof typeof confirmations] || 12;
  }

  // Simulate transaction confirmation (for demo purposes)
  static async simulateTransactionConfirmation(transactionId: string): Promise<boolean> {
    const { error } = await supabase
      .from('crypto_transactions')
      .update({
        status: 'confirmed',
        tx_hash: this.generateTxHash(),
        confirmations: 50 // Simulate enough confirmations
      })
      .eq('id', transactionId);

    return !error;
  }

  private static generateTxHash(): string {
    const chars = '0123456789abcdef';
    let result = '0x';
    for (let i = 0; i < 64; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}