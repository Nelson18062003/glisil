export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instanciate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      crypto_transactions: {
        Row: {
          amount: number
          confirmations: number | null
          created_at: string | null
          currency: string
          id: string
          network: string
          required_confirmations: number | null
          status: string | null
          tx_hash: string | null
          type: string
          updated_at: string | null
          user_id: string
          wallet_address: string
        }
        Insert: {
          amount: number
          confirmations?: number | null
          created_at?: string | null
          currency: string
          id?: string
          network: string
          required_confirmations?: number | null
          status?: string | null
          tx_hash?: string | null
          type: string
          updated_at?: string | null
          user_id: string
          wallet_address: string
        }
        Update: {
          amount?: number
          confirmations?: number | null
          created_at?: string | null
          currency?: string
          id?: string
          network?: string
          required_confirmations?: number | null
          status?: string | null
          tx_hash?: string | null
          type?: string
          updated_at?: string | null
          user_id?: string
          wallet_address?: string
        }
        Relationships: []
      }
      exchange_rates: {
        Row: {
          change_24h: number | null
          created_at: string | null
          from_currency: string
          high_24h: number | null
          id: string
          low_24h: number | null
          rate: number
          to_currency: string
          volume_24h: number | null
        }
        Insert: {
          change_24h?: number | null
          created_at?: string | null
          from_currency: string
          high_24h?: number | null
          id?: string
          low_24h?: number | null
          rate: number
          to_currency: string
          volume_24h?: number | null
        }
        Update: {
          change_24h?: number | null
          created_at?: string | null
          from_currency?: string
          high_24h?: number | null
          id?: string
          low_24h?: number | null
          rate?: number
          to_currency?: string
          volume_24h?: number | null
        }
        Relationships: []
      }
      mint_operations: {
        Row: {
          account_name: string | null
          account_number: string | null
          created_at: string
          expires_at: string | null
          id: string
          minted_at: string | null
          notes: string | null
          payment_channel: string
          payment_method: string
          proof_file_url: string | null
          reference_id: string
          status: string | null
          updated_at: string
          user_id: string
          verified_at: string | null
          xaf_amount: number
          xafe_amount: number
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          minted_at?: string | null
          notes?: string | null
          payment_channel: string
          payment_method: string
          proof_file_url?: string | null
          reference_id: string
          status?: string | null
          updated_at?: string
          user_id: string
          verified_at?: string | null
          xaf_amount: number
          xafe_amount: number
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          minted_at?: string | null
          notes?: string | null
          payment_channel?: string
          payment_method?: string
          proof_file_url?: string | null
          reference_id?: string
          status?: string | null
          updated_at?: string
          user_id?: string
          verified_at?: string | null
          xaf_amount?: number
          xafe_amount?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string
          first_name: string | null
          id: string
          kyc_status: string | null
          last_name: string | null
          phone: string | null
          updated_at: string | null
          user_id: string
          wallet_address: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          first_name?: string | null
          id?: string
          kyc_status?: string | null
          last_name?: string | null
          phone?: string | null
          updated_at?: string | null
          user_id: string
          wallet_address?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          first_name?: string | null
          id?: string
          kyc_status?: string | null
          last_name?: string | null
          phone?: string | null
          updated_at?: string | null
          user_id?: string
          wallet_address?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          created_at: string | null
          exchange_rate: number | null
          external_ref: string | null
          fee_amount: number | null
          from_amount: number | null
          from_currency: string | null
          id: string
          network: string | null
          notes: string | null
          payment_method: string | null
          status: string | null
          to_amount: number | null
          to_currency: string | null
          transaction_hash: string | null
          type: string
          updated_at: string | null
          user_id: string
          wallet_address: string | null
        }
        Insert: {
          created_at?: string | null
          exchange_rate?: number | null
          external_ref?: string | null
          fee_amount?: number | null
          from_amount?: number | null
          from_currency?: string | null
          id?: string
          network?: string | null
          notes?: string | null
          payment_method?: string | null
          status?: string | null
          to_amount?: number | null
          to_currency?: string | null
          transaction_hash?: string | null
          type: string
          updated_at?: string | null
          user_id: string
          wallet_address?: string | null
        }
        Update: {
          created_at?: string | null
          exchange_rate?: number | null
          external_ref?: string | null
          fee_amount?: number | null
          from_amount?: number | null
          from_currency?: string | null
          id?: string
          network?: string | null
          notes?: string | null
          payment_method?: string | null
          status?: string | null
          to_amount?: number | null
          to_currency?: string | null
          transaction_hash?: string | null
          type?: string
          updated_at?: string | null
          user_id?: string
          wallet_address?: string | null
        }
        Relationships: []
      }
      wallet_addresses: {
        Row: {
          address: string
          created_at: string | null
          id: string
          is_primary: boolean | null
          network: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          network: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          network?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          created_at: string | null
          deposit_addresses: Json | null
          id: string
          total_deposited: number | null
          total_withdrawn: number | null
          updated_at: string | null
          usdt_balance: number | null
          user_id: string
          xafe_balance: number | null
        }
        Insert: {
          created_at?: string | null
          deposit_addresses?: Json | null
          id?: string
          total_deposited?: number | null
          total_withdrawn?: number | null
          updated_at?: string | null
          usdt_balance?: number | null
          user_id: string
          xafe_balance?: number | null
        }
        Update: {
          created_at?: string | null
          deposit_addresses?: Json | null
          id?: string
          total_deposited?: number | null
          total_withdrawn?: number | null
          updated_at?: string | null
          usdt_balance?: number | null
          user_id?: string
          xafe_balance?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_deposit_addresses: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      generate_mint_reference: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
