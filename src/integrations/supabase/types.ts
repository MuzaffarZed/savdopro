export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          changed_at: string
          changed_fields: string[] | null
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          changed_at?: string
          changed_fields?: string[] | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          changed_at?: string
          changed_fields?: string[] | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      branches: {
        Row: {
          address: string | null
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          balance: number
          branch_id: string | null
          created_at: string
          credit_limit: number
          deleted_at: string | null
          id: string
          image_url: string | null
          latitude: number | null
          longitude: number | null
          name: string
          opening_balance: number
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          balance?: number
          branch_id?: string | null
          created_at?: string
          credit_limit?: number
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          latitude?: number | null
          longitude?: number | null
          name: string
          opening_balance?: number
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          balance?: number
          branch_id?: string | null
          created_at?: string
          credit_limit?: number
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          opening_balance?: number
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      damages: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          product_id: string
          quantity: number
          reason: string
          total_cost: number
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          product_id: string
          quantity: number
          reason: string
          total_cost?: number
          warehouse_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          product_id?: string
          quantity?: number
          reason?: string
          total_cost?: number
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "damages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "damages_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          key: string
          result_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          key: string
          result_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          key?: string
          result_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      inventory_batches: {
        Row: {
          cost_price: number
          created_at: string
          id: string
          product_id: string
          quantity: number
          remaining: number
          source_batch_id: string | null
          warehouse_id: string
        }
        Insert: {
          cost_price: number
          created_at?: string
          id?: string
          product_id: string
          quantity: number
          remaining: number
          source_batch_id?: string | null
          warehouse_id: string
        }
        Update: {
          cost_price?: number
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          remaining?: number
          source_batch_id?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_batches_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "inventory_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_batches_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          batch_id: string | null
          cost_price: number | null
          created_at: string
          created_by: string | null
          id: string
          product_id: string
          quantity: number
          ref_id: string | null
          ref_type: string | null
          type: Database["public"]["Enums"]["movement_type"]
          warehouse_id: string
        }
        Insert: {
          batch_id?: string | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          product_id: string
          quantity: number
          ref_id?: string | null
          ref_type?: string | null
          type: Database["public"]["Enums"]["movement_type"]
          warehouse_id: string
        }
        Update: {
          batch_id?: string | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string
          quantity?: number
          ref_id?: string | null
          ref_type?: string | null
          type?: Database["public"]["Enums"]["movement_type"]
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "inventory_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          sale_id: string | null
          shift_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          sale_id?: string | null
          shift_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          sale_id?: string | null
          shift_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      pricelist_overrides: {
        Row: {
          markup: number | null
          price: number | null
          product_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          markup?: number | null
          price?: number | null
          product_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          markup?: number | null
          price?: number | null
          product_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      pricelist_settings: {
        Row: {
          default_markup: number
          id: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          default_markup?: number
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          default_markup?: number
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          category: string | null
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          name: string
          phone: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id: string
          name: string
          phone?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          cost_price: number
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          product_id: string
          quantity: number
          total_cost: number
          warehouse_id: string
        }
        Insert: {
          cost_price: number
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          product_id: string
          quantity: number
          total_cost: number
          warehouse_id: string
        }
        Update: {
          cost_price?: number
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          product_id?: string
          quantity?: number
          total_cost?: number
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          quantity: number
          sale_id: string
          sell_price: number
          total_cost: number
          total_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          quantity: number
          sale_id: string
          sell_price: number
          total_cost?: number
          total_price: number
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          sale_id?: string
          sell_price?: number
          total_cost?: number
          total_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          amount_paid: number
          branch_id: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          profit: number
          remaining_debt: number
          shift_id: string | null
          status: string
          total_cost: number
          total_sale: number
          warehouse_id: string
        }
        Insert: {
          amount_paid?: number
          branch_id: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          profit?: number
          remaining_debt?: number
          shift_id?: string | null
          status?: string
          total_cost?: number
          total_sale?: number
          warehouse_id: string
        }
        Update: {
          amount_paid?: number
          branch_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          profit?: number
          remaining_debt?: number
          shift_id?: string | null
          status?: string
          total_cost?: number
          total_sale?: number
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          branch_id: string | null
          closed_at: string | null
          closing_cash: number | null
          created_at: string
          difference: number | null
          expected_cash: number | null
          id: string
          note: string | null
          opened_at: string
          opening_cash: number
          sales_count: number
          status: string
          total_cash: number
          total_click: number
          total_debt: number
          total_sales: number
          user_id: string
          warehouse_id: string | null
        }
        Insert: {
          branch_id?: string | null
          closed_at?: string | null
          closing_cash?: number | null
          created_at?: string
          difference?: number | null
          expected_cash?: number | null
          id?: string
          note?: string | null
          opened_at?: string
          opening_cash?: number
          sales_count?: number
          status?: string
          total_cash?: number
          total_click?: number
          total_debt?: number
          total_sales?: number
          user_id: string
          warehouse_id?: string | null
        }
        Update: {
          branch_id?: string | null
          closed_at?: string | null
          closing_cash?: number | null
          created_at?: string
          difference?: number | null
          expected_cash?: number | null
          id?: string
          note?: string | null
          opened_at?: string
          opening_cash?: number
          sales_count?: number
          status?: string
          total_cash?: number
          total_click?: number
          total_debt?: number
          total_sales?: number
          user_id?: string
          warehouse_id?: string | null
        }
        Relationships: []
      }
      transfer_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          new_note: string | null
          old_note: string | null
          snapshot: Json | null
          transfer_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_note?: string | null
          old_note?: string | null
          snapshot?: Json | null
          transfer_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_note?: string | null
          old_note?: string | null
          snapshot?: Json | null
          transfer_id?: string
        }
        Relationships: []
      }
      transfer_items: {
        Row: {
          cost_price: number
          created_at: string
          dest_batch_id: string
          id: string
          product_id: string
          quantity: number
          source_batch_id: string
          transfer_id: string
        }
        Insert: {
          cost_price: number
          created_at?: string
          dest_batch_id: string
          id?: string
          product_id: string
          quantity: number
          source_batch_id: string
          transfer_id: string
        }
        Update: {
          cost_price?: number
          created_at?: string
          dest_batch_id?: string
          id?: string
          product_id?: string
          quantity?: number
          source_batch_id?: string
          transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_items_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      transfers: {
        Row: {
          created_at: string
          created_by: string | null
          from_warehouse_id: string
          id: string
          note: string | null
          status: string
          to_warehouse_id: string
          total_cost: number
          total_quantity: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_warehouse_id: string
          id?: string
          note?: string | null
          status?: string
          to_warehouse_id: string
          total_cost?: number
          total_quantity?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_warehouse_id?: string
          id?: string
          note?: string | null
          status?: string
          to_warehouse_id?: string
          total_cost?: number
          total_quantity?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      warehouses: {
        Row: {
          branch_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          type: Database["public"]["Enums"]["warehouse_type"]
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          type: Database["public"]["Enums"]["warehouse_type"]
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          type?: Database["public"]["Enums"]["warehouse_type"]
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      inventory_audit: {
        Row: {
          batch_remaining: number | null
          movement_balance: number | null
          product_id: string | null
          warehouse_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_batches_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      close_shift: {
        Args: {
          _closing_cash: number
          _note: string
          _shift_id: string
          _user_id: string
        }
        Returns: undefined
      }
      delete_customer: {
        Args: { _customer_id: string; _user_id: string }
        Returns: string
      }
      delete_damage: {
        Args: { _damage_id: string; _user_id: string }
        Returns: undefined
      }
      delete_payment: {
        Args: { _payment_id: string; _user_id: string }
        Returns: undefined
      }
      delete_purchase: {
        Args: { _purchase_id: string; _user_id: string }
        Returns: undefined
      }
      delete_sale: {
        Args: { _sale_id: string; _user_id: string }
        Returns: undefined
      }
      delete_shift: {
        Args: { _shift_id: string; _user_id: string }
        Returns: undefined
      }
      delete_transfer: {
        Args: { _transfer_id: string; _user_id: string }
        Returns: undefined
      }
      get_user_branch: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      open_shift: {
        Args: {
          _branch_id: string
          _opening_cash: number
          _user_id: string
          _warehouse_id: string
        }
        Returns: string
      }
      process_damage: {
        Args: {
          _idempotency_key: string
          _note: string
          _product_id: string
          _quantity: number
          _reason: string
          _user_id: string
          _warehouse_id: string
        }
        Returns: string
      }
      process_debt_payment: {
        Args: {
          _amount: number
          _customer_id: string
          _idempotency_key: string
          _method: Database["public"]["Enums"]["payment_method"]
          _note: string
          _user_id: string
        }
        Returns: string
      }
      process_purchase: {
        Args: {
          _cost_price: number
          _idempotency_key: string
          _note: string
          _product_id: string
          _quantity: number
          _user_id: string
          _warehouse_id: string
        }
        Returns: string
      }
      process_sale: {
        Args: {
          _amount_paid: number
          _branch_id: string
          _cash_paid?: number
          _click_paid?: number
          _customer_id: string
          _idempotency_key: string
          _items: Json
          _payment_method: Database["public"]["Enums"]["payment_method"]
          _user_id: string
          _warehouse_id: string
        }
        Returns: string
      }
      process_transfer: {
        Args: {
          _from_warehouse_id: string
          _idempotency_key: string
          _items: Json
          _note: string
          _to_warehouse_id: string
          _user_id: string
        }
        Returns: string
      }
      recalc_customer_balance: {
        Args: { _customer_id: string }
        Returns: number
      }
      rollback_sale: {
        Args: { _sale_id: string; _user_id: string }
        Returns: undefined
      }
      update_damage: {
        Args: {
          _damage_id: string
          _note: string
          _quantity: number
          _reason: string
          _user_id: string
        }
        Returns: undefined
      }
      update_purchase: {
        Args: {
          _cost_price: number
          _note: string
          _purchase_id: string
          _quantity: number
          _user_id: string
        }
        Returns: undefined
      }
      update_sale_items: {
        Args: { _items: Json; _sale_id: string; _user_id: string }
        Returns: undefined
      }
      update_sale_payment: {
        Args: {
          _amount_paid: number
          _customer_id: string
          _payment_method: Database["public"]["Enums"]["payment_method"]
          _sale_id: string
          _user_id: string
        }
        Returns: undefined
      }
      update_transfer_items:
        | {
            Args: {
              _items: Json
              _note: string
              _transfer_id: string
              _user_id: string
            }
            Returns: undefined
          }
        | {
            Args: {
              _idempotency_key?: string
              _items: Json
              _note: string
              _transfer_id: string
              _user_id: string
            }
            Returns: undefined
          }
      update_transfer_note: {
        Args: { _note: string; _transfer_id: string; _user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "super_admin" | "branch_user"
      movement_type:
        | "purchase"
        | "transfer_out"
        | "transfer_in"
        | "sale"
        | "rollback"
        | "damage"
      payment_method: "cash" | "click"
      warehouse_type: "main" | "branch"
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
    Enums: {
      app_role: ["super_admin", "branch_user"],
      movement_type: [
        "purchase",
        "transfer_out",
        "transfer_in",
        "sale",
        "rollback",
        "damage",
      ],
      payment_method: ["cash", "click"],
      warehouse_type: ["main", "branch"],
    },
  },
} as const
