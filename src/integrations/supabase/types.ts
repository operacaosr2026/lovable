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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          archived: boolean
          color: string
          created_at: string
          currency: string
          icon_url: string | null
          id: string
          match_keywords: string[]
          name: string
          position: number
          user_id: string
        }
        Insert: {
          archived?: boolean
          color?: string
          created_at?: string
          currency: string
          icon_url?: string | null
          id?: string
          match_keywords?: string[]
          name: string
          position?: number
          user_id: string
        }
        Update: {
          archived?: boolean
          color?: string
          created_at?: string
          currency?: string
          icon_url?: string | null
          id?: string
          match_keywords?: string[]
          name?: string
          position?: number
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          app_name: string
          created_at: string
          date_format: string
          default_home: string
          density: string
          favicon_url: string | null
          font_size: string
          language: string
          logo_url: string | null
          primary_color: string
          theme: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_name?: string
          created_at?: string
          date_format?: string
          default_home?: string
          density?: string
          favicon_url?: string | null
          font_size?: string
          language?: string
          logo_url?: string | null
          primary_color?: string
          theme?: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_name?: string
          created_at?: string
          date_format?: string
          default_home?: string
          density?: string
          favicon_url?: string | null
          font_size?: string
          language?: string
          logo_url?: string | null
          primary_color?: string
          theme?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bank_account_links: {
        Row: {
          account_id: string
          connection_id: string
          created_at: string
          external_account_id: string
          external_account_name: string | null
          external_currency: string | null
          id: string
          last_external_uid: string | null
          last_synced_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          connection_id: string
          created_at?: string
          external_account_id: string
          external_account_name?: string | null
          external_currency?: string | null
          id?: string
          last_external_uid?: string | null
          last_synced_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          connection_id?: string
          created_at?: string
          external_account_id?: string
          external_account_name?: string | null
          external_currency?: string | null
          id?: string
          last_external_uid?: string | null
          last_synced_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_account_links_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_account_links_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "bank_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_connections: {
        Row: {
          access_token_encrypted: string
          created_at: string
          id: string
          label: string
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          provider: string
          updated_at: string
          user_id: string
          wise_profile_id: string | null
        }
        Insert: {
          access_token_encrypted: string
          created_at?: string
          id?: string
          label: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          provider: string
          updated_at?: string
          user_id: string
          wise_profile_id?: string | null
        }
        Update: {
          access_token_encrypted?: string
          created_at?: string
          id?: string
          label?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          provider?: string
          updated_at?: string
          user_id?: string
          wise_profile_id?: string | null
        }
        Relationships: []
      }
      calendar_events: {
        Row: {
          all_day: boolean | null
          color: string
          created_at: string | null
          date: string
          end_time: string | null
          id: string
          member_ids: string[]
          start_time: string | null
          title: string
          user_id: string
        }
        Insert: {
          all_day?: boolean | null
          color?: string
          created_at?: string | null
          date: string
          end_time?: string | null
          id?: string
          member_ids?: string[]
          start_time?: string | null
          title: string
          user_id: string
        }
        Update: {
          all_day?: boolean | null
          color?: string
          created_at?: string | null
          date?: string
          end_time?: string | null
          id?: string
          member_ids?: string[]
          start_time?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          color: string
          created_at: string
          id: string
          kind: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          kind: string
          name: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      category_rules: {
        Row: {
          applies_to: string
          category_id: string
          created_at: string
          enabled: boolean
          id: string
          match_type: string
          match_value: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          applies_to?: string
          category_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          match_type?: string
          match_value: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          applies_to?: string
          category_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          match_type?: string
          match_value?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_goals: {
        Row: {
          created_at: string
          id: string
          month: number | null
          period: string
          target_amount_brl: number
          user_id: string
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          month?: number | null
          period: string
          target_amount_brl: number
          user_id: string
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          month?: number | null
          period?: string
          target_amount_brl?: number
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          updated_at: string
          usd_to_brl: number
          user_id: string
        }
        Insert: {
          updated_at?: string
          usd_to_brl?: number
          user_id: string
        }
        Update: {
          updated_at?: string
          usd_to_brl?: number
          user_id?: string
        }
        Relationships: []
      }
      gratitude_entries: {
        Row: {
          content: string
          created_at: string
          date: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          date: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          date?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      habit_logs: {
        Row: {
          created_at: string
          date: string
          habit_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          habit_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          habit_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_logs_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
        ]
      }
      habits: {
        Row: {
          annual_goal: number | null
          created_at: string
          id: string
          name: string
          position: number
          user_id: string
          weekly_goal: number
        }
        Insert: {
          annual_goal?: number | null
          created_at?: string
          id?: string
          name: string
          position?: number
          user_id: string
          weekly_goal?: number
        }
        Update: {
          annual_goal?: number | null
          created_at?: string
          id?: string
          name?: string
          position?: number
          user_id?: string
          weekly_goal?: number
        }
        Relationships: []
      }
      journal_pages: {
        Row: {
          content: string
          created_at: string
          icon: string | null
          id: string
          is_favorite: boolean
          last_opened_at: string | null
          parent_id: string | null
          position: number
          shop_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          icon?: string | null
          id?: string
          is_favorite?: boolean
          last_opened_at?: string | null
          parent_id?: string | null
          position?: number
          shop_id?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          icon?: string | null
          id?: string
          is_favorite?: boolean
          last_opened_at?: string | null
          parent_id?: string | null
          position?: number
          shop_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_pages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "journal_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      kanban_columns: {
        Row: {
          board_id: string
          board_type: string
          color: string
          created_at: string
          id: string
          key: string
          label: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          board_id: string
          board_type: string
          color?: string
          created_at?: string
          id?: string
          key: string
          label: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          board_id?: string
          board_type?: string
          color?: string
          created_at?: string
          id?: string
          key?: string
          label?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      login_history: {
        Row: {
          created_at: string
          id: string
          ip: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      member_invitations: {
        Row: {
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          owner_id: string
          permissions: Json
          status: string
          token: string
        }
        Insert: {
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          owner_id: string
          permissions?: Json
          status?: string
          token: string
        }
        Update: {
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          owner_id?: string
          permissions?: Json
          status?: string
          token?: string
        }
        Relationships: []
      }
      member_permissions: {
        Row: {
          created_at: string
          id: string
          member_id: string
          owner_id: string
          resource_id: string | null
          section: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          owner_id: string
          resource_id?: string | null
          section: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          owner_id?: string
          resource_id?: string | null
          section?: string
        }
        Relationships: []
      }
      mercury_category_rules: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          match_field: string
          match_type: string
          match_value: string
          position: number
          shop_id: string
          target_category: string
          target_kind: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          match_field?: string
          match_type?: string
          match_value: string
          position?: number
          shop_id: string
          target_category: string
          target_kind: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          match_field?: string
          match_type?: string
          match_value?: string
          position?: number
          shop_id?: string
          target_category?: string
          target_kind?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mercury_links: {
        Row: {
          cached_balance: number | null
          cached_balance_at: string | null
          created_at: string
          id: string
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          mercury_account_id: string
          mercury_account_name: string | null
          shop_id: string
          sync_since: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cached_balance?: number | null
          cached_balance_at?: string | null
          created_at?: string
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          mercury_account_id: string
          mercury_account_name?: string | null
          shop_id: string
          sync_since?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cached_balance?: number | null
          cached_balance_at?: string | null
          created_at?: string
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          mercury_account_id?: string
          mercury_account_name?: string | null
          shop_id?: string
          sync_since?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      meta_ads_integrations: {
        Row: {
          access_token: string | null
          account_name: string | null
          ad_account_id: string | null
          created_at: string
          currency: string | null
          enabled: boolean
          id: string
          journal_page_id: string | null
          last_activities_sync_at: string | null
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          shop_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          account_name?: string | null
          ad_account_id?: string | null
          created_at?: string
          currency?: string | null
          enabled?: boolean
          id?: string
          journal_page_id?: string | null
          last_activities_sync_at?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          shop_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          account_name?: string | null
          ad_account_id?: string | null
          created_at?: string
          currency?: string | null
          enabled?: boolean
          id?: string
          journal_page_id?: string | null
          last_activities_sync_at?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          shop_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_integrations_journal_page_id_fkey"
            columns: ["journal_page_id"]
            isOneToOne: false
            referencedRelation: "journal_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_oauth_states: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          shop_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string
          id?: string
          shop_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          shop_id?: string
          user_id?: string
        }
        Relationships: []
      }
      product_creatives: {
        Row: {
          created_at: string
          description: string | null
          descriptions: Json
          id: string
          media_kind: string | null
          media_path: string | null
          media_url: string | null
          name: string
          position: number
          product_id: string
          status: string
          texts: Json
          title: string
          titles: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          descriptions?: Json
          id?: string
          media_kind?: string | null
          media_path?: string | null
          media_url?: string | null
          name?: string
          position?: number
          product_id: string
          status?: string
          texts?: Json
          title?: string
          titles?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          descriptions?: Json
          id?: string
          media_kind?: string | null
          media_path?: string | null
          media_url?: string | null
          name?: string
          position?: number
          product_id?: string
          status?: string
          texts?: Json
          title?: string
          titles?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_creatives_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          created_at: string
          file_name: string | null
          file_path: string
          file_url: string | null
          id: string
          is_main: boolean
          mime_type: string | null
          position: number
          product_id: string
          size_bytes: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          file_path: string
          file_url?: string | null
          id?: string
          is_main?: boolean
          mime_type?: string | null
          position?: number
          product_id: string
          size_bytes?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string | null
          file_path?: string
          file_url?: string | null
          id?: string
          is_main?: boolean
          mime_type?: string | null
          position?: number
          product_id?: string
          size_bytes?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_pricing: {
        Row: {
          dom_pagamentos_pct: number
          imposto_pct: number
          iof_pct: number
          marketing_pct: number
          payments_pct: number
          product_id: string
          retorno_chargeback_pct: number
          updated_at: string
          user_id: string
        }
        Insert: {
          dom_pagamentos_pct?: number
          imposto_pct?: number
          iof_pct?: number
          marketing_pct?: number
          payments_pct?: number
          product_id: string
          retorno_chargeback_pct?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          dom_pagamentos_pct?: number
          imposto_pct?: number
          iof_pct?: number
          marketing_pct?: number
          payments_pct?: number
          product_id?: string
          retorno_chargeback_pct?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_pricing_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_templates: {
        Row: {
          created_at: string
          file_name: string | null
          file_path: string | null
          file_url: string | null
          id: string
          kind: string
          mime_type: string | null
          notes: string | null
          pagefly_url: string | null
          product_id: string
          size_bytes: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          file_url?: string | null
          id?: string
          kind?: string
          mime_type?: string | null
          notes?: string | null
          pagefly_url?: string | null
          product_id: string
          size_bytes?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          file_url?: string | null
          id?: string
          kind?: string
          mime_type?: string | null
          notes?: string | null
          pagefly_url?: string | null
          product_id?: string
          size_bytes?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_templates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          archived: boolean
          cost: number
          created_at: string
          description: string | null
          id: string
          main_image_url: string | null
          name: string
          niche: string | null
          position: number
          sale_price: number
          status: string
          supplier: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          cost?: number
          created_at?: string
          description?: string | null
          id?: string
          main_image_url?: string | null
          name: string
          niche?: string | null
          position?: number
          sale_price?: number
          status?: string
          supplier?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          cost?: number
          created_at?: string
          description?: string | null
          id?: string
          main_image_url?: string | null
          name?: string
          niche?: string | null
          position?: number
          sale_price?: number
          status?: string
          supplier?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          project_id: string
          size_bytes: number | null
          task_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          project_id: string
          size_bytes?: number | null
          task_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          project_id?: string
          size_bytes?: number | null
          task_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_notes: {
        Row: {
          content: string
          created_at: string
          id: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tasks: {
        Row: {
          checklist: Json
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          parent_task_id: string | null
          position: number
          project_id: string
          recurrence_frequency: string | null
          recurrence_time: string | null
          recurrence_weekdays: number[]
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          checklist?: Json
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          parent_task_id?: string | null
          position?: number
          project_id: string
          recurrence_frequency?: string | null
          recurrence_time?: string | null
          recurrence_weekdays?: number[]
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          checklist?: Json
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          parent_task_id?: string | null
          position?: number
          project_id?: string
          recurrence_frequency?: string | null
          recurrence_time?: string | null
          recurrence_weekdays?: number[]
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived: boolean
          category: string
          color: string
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          name: string
          position: number
          priority: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          category?: string
          color?: string
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          name: string
          position?: number
          priority?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          category?: string
          color?: string
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          name?: string
          position?: number
          priority?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      recurrences: {
        Row: {
          account_id: string
          active: boolean
          amount: number
          category_id: string | null
          created_at: string
          currency: string
          description: string | null
          frequency: string
          id: string
          kind: string
          next_date: string
          user_id: string
        }
        Insert: {
          account_id: string
          active?: boolean
          amount: number
          category_id?: string | null
          created_at?: string
          currency: string
          description?: string | null
          frequency: string
          id?: string
          kind: string
          next_date: string
          user_id: string
        }
        Update: {
          account_id?: string
          active?: boolean
          amount?: number
          category_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          frequency?: string
          id?: string
          kind?: string
          next_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurrences_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurrences_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_cash_categories: {
        Row: {
          created_at: string
          id: string
          kind: string
          name: string
          position: number
          shop_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          name: string
          position?: number
          shop_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          name?: string
          position?: number
          shop_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shop_cash_entries: {
        Row: {
          amount: number
          auto_kind: string | null
          auto_ref_date: string | null
          category: string | null
          created_at: string
          date: string
          description: string | null
          id: string
          import_id: string | null
          kind: string
          mercury_transaction_id: string | null
          reconciled: boolean
          recurrence: string
          recurrence_until: string | null
          shop_id: string
          shopify_payout_id: string | null
          skip_weekend_rule: boolean
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          auto_kind?: string | null
          auto_ref_date?: string | null
          category?: string | null
          created_at?: string
          date: string
          description?: string | null
          id?: string
          import_id?: string | null
          kind: string
          mercury_transaction_id?: string | null
          reconciled?: boolean
          recurrence?: string
          recurrence_until?: string | null
          shop_id: string
          shopify_payout_id?: string | null
          skip_weekend_rule?: boolean
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          auto_kind?: string | null
          auto_ref_date?: string | null
          category?: string | null
          created_at?: string
          date?: string
          description?: string | null
          id?: string
          import_id?: string | null
          kind?: string
          mercury_transaction_id?: string | null
          reconciled?: boolean
          recurrence?: string
          recurrence_until?: string | null
          shop_id?: string
          shopify_payout_id?: string | null
          skip_weekend_rule?: boolean
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_cash_entries_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "shop_cash_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_cash_imports: {
        Row: {
          created_at: string
          file_hash: string | null
          file_name: string
          id: string
          shop_id: string
          total_amount: number
          total_rows: number
          user_id: string
        }
        Insert: {
          created_at?: string
          file_hash?: string | null
          file_name: string
          id?: string
          shop_id: string
          total_amount?: number
          total_rows?: number
          user_id: string
        }
        Update: {
          created_at?: string
          file_hash?: string | null
          file_name?: string
          id?: string
          shop_id?: string
          total_amount?: number
          total_rows?: number
          user_id?: string
        }
        Relationships: []
      }
      shop_group_stores: {
        Row: {
          created_at: string | null
          group_id: string
          id: string
          role: string
          shopify_store_id: string
        }
        Insert: {
          created_at?: string | null
          group_id: string
          id?: string
          role?: string
          shopify_store_id: string
        }
        Update: {
          created_at?: string | null
          group_id?: string
          id?: string
          role?: string
          shopify_store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_group_stores_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "shop_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_group_stores_shopify_store_id_fkey"
            columns: ["shopify_store_id"]
            isOneToOne: false
            referencedRelation: "shopify_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_groups: {
        Row: {
          country: string | null
          created_at: string | null
          description: string | null
          id: string
          logo_url: string | null
          name: string
          status: string
          tag: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          country?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          status?: string
          tag?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          country?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          status?: string
          tag?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      shop_meta_tokens: {
        Row: {
          access_token: string
          ad_accounts: Json | null
          created_at: string | null
          fb_user_id: string | null
          fb_user_name: string | null
          id: string
          selected_ad_account_id: string | null
          selected_campaign_ids: Json | null
          shop_id: string
          token_expires_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          ad_accounts?: Json | null
          created_at?: string | null
          fb_user_id?: string | null
          fb_user_name?: string | null
          id?: string
          selected_ad_account_id?: string | null
          selected_campaign_ids?: Json | null
          shop_id: string
          token_expires_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          ad_accounts?: Json | null
          created_at?: string | null
          fb_user_id?: string | null
          fb_user_name?: string | null
          id?: string
          selected_ad_account_id?: string | null
          selected_campaign_ids?: Json | null
          shop_id?: string
          token_expires_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      shop_order_payment_batches: {
        Row: {
          batch_number: number
          cash_entry_id: string | null
          created_at: string
          description: string | null
          id: string
          order_dates: string[]
          payment_date: string
          shop_id: string
          total_amount: number
          total_items: number
          total_orders: number
          updated_at: string
          user_id: string
        }
        Insert: {
          batch_number: number
          cash_entry_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          order_dates?: string[]
          payment_date: string
          shop_id: string
          total_amount?: number
          total_items?: number
          total_orders?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          batch_number?: number
          cash_entry_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          order_dates?: string[]
          payment_date?: string
          shop_id?: string
          total_amount?: number
          total_items?: number
          total_orders?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shop_order_settings: {
        Row: {
          automation_enabled: boolean
          cashflow_start_date: string | null
          created_at: string
          default_unit_cost: number
          linked_product_id: string | null
          payout_lag_avg_days: number | null
          payout_lag_sample_size: number | null
          processing_delay_days: number
          shop_id: string
          shopify_store_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          automation_enabled?: boolean
          cashflow_start_date?: string | null
          created_at?: string
          default_unit_cost?: number
          linked_product_id?: string | null
          payout_lag_avg_days?: number | null
          payout_lag_sample_size?: number | null
          processing_delay_days?: number
          shop_id: string
          shopify_store_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          automation_enabled?: boolean
          cashflow_start_date?: string | null
          created_at?: string
          default_unit_cost?: number
          linked_product_id?: string | null
          payout_lag_avg_days?: number | null
          payout_lag_sample_size?: number | null
          processing_delay_days?: number
          shop_id?: string
          shopify_store_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shop_order_tracking: {
        Row: {
          carrier: string | null
          created_at: string
          delivered_at: string | null
          id: string
          last_event_at: string | null
          last_event_label: string | null
          order_id: string
          problem_at: string | null
          shipped_at: string | null
          shop_id: string
          timeline: Json
          tracking_number: string | null
          tracking_status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          carrier?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          last_event_at?: string | null
          last_event_label?: string | null
          order_id: string
          problem_at?: string | null
          shipped_at?: string | null
          shop_id: string
          timeline?: Json
          tracking_number?: string | null
          tracking_status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          carrier?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          last_event_at?: string | null
          last_event_label?: string | null
          order_id?: string
          problem_at?: string | null
          shipped_at?: string | null
          shop_id?: string
          timeline?: Json
          tracking_number?: string | null
          tracking_status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shop_orders: {
        Row: {
          connection_id: string | null
          created_at: string
          created_at_shopify: string
          currency: string | null
          delivered_at: string | null
          external_id: string
          id: string
          items_count: number
          order_date: string
          order_number: string | null
          paid_at: string | null
          payment_batch_id: string | null
          payment_status: string
          problem_at: string | null
          raw: Json | null
          revenue: number
          shipped_at: string | null
          shop_id: string
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_id?: string | null
          created_at?: string
          created_at_shopify: string
          currency?: string | null
          delivered_at?: string | null
          external_id: string
          id?: string
          items_count?: number
          order_date: string
          order_number?: string | null
          paid_at?: string | null
          payment_batch_id?: string | null
          payment_status?: string
          problem_at?: string | null
          raw?: Json | null
          revenue?: number
          shipped_at?: string | null
          shop_id: string
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_id?: string | null
          created_at?: string
          created_at_shopify?: string
          currency?: string | null
          delivered_at?: string | null
          external_id?: string
          id?: string
          items_count?: number
          order_date?: string
          order_number?: string | null
          paid_at?: string | null
          payment_batch_id?: string | null
          payment_status?: string
          problem_at?: string | null
          raw?: Json | null
          revenue?: number
          shipped_at?: string | null
          shop_id?: string
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_orders_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "shopify_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_product_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          product_id: string
          size_bytes: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          product_id: string
          size_bytes?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          product_id?: string
          size_bytes?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_product_attachments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shop_products"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_product_cost_history: {
        Row: {
          created_at: string
          id: string
          note: string | null
          shop_id: string
          unit_cost: number
          user_id: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          shop_id: string
          unit_cost: number
          user_id: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          shop_id?: string
          unit_cost?: number
          user_id?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      shop_products: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          links: Json
          name: string
          notes: string | null
          position: number
          product_date: string | null
          product_id: string | null
          shop_id: string
          status: string
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          links?: Json
          name: string
          notes?: string | null
          position?: number
          product_date?: string | null
          product_id?: string | null
          shop_id: string
          status?: string
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          links?: Json
          name?: string
          notes?: string | null
          position?: number
          product_date?: string | null
          product_id?: string | null
          shop_id?: string
          status?: string
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_products_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_profit_goals: {
        Row: {
          created_at: string
          currency: string
          daily_budget: number
          end_date: string
          fees_pct: number
          id: string
          max_cpa: number
          sale_price: number
          shop_id: string
          start_date: string
          supplier_cost: number
          target_profit: number
          total_marketing: number
          total_revenue: number
          total_sales: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          daily_budget?: number
          end_date?: string
          fees_pct?: number
          id?: string
          max_cpa?: number
          sale_price?: number
          shop_id: string
          start_date?: string
          supplier_cost?: number
          target_profit?: number
          total_marketing?: number
          total_revenue?: number
          total_sales?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          daily_budget?: number
          end_date?: string
          fees_pct?: number
          id?: string
          max_cpa?: number
          sale_price?: number
          shop_id?: string
          start_date?: string
          supplier_cost?: number
          target_profit?: number
          total_marketing?: number
          total_revenue?: number
          total_sales?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shop_routine_logs: {
        Row: {
          completed_at: string
          completed_on: string
          id: string
          routine_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          completed_on?: string
          id?: string
          routine_id: string
          user_id: string
        }
        Update: {
          completed_at?: string
          completed_on?: string
          id?: string
          routine_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_routine_logs_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "shop_routines"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_routines: {
        Row: {
          created_at: string
          description: string | null
          due_at: string | null
          frequency: string
          id: string
          last_completed_at: string | null
          position: number
          reminder_minutes: number[]
          shop_id: string
          streak: number
          time: string | null
          title: string
          updated_at: string
          user_id: string
          weekdays: number[]
        }
        Insert: {
          created_at?: string
          description?: string | null
          due_at?: string | null
          frequency?: string
          id?: string
          last_completed_at?: string | null
          position?: number
          reminder_minutes?: number[]
          shop_id: string
          streak?: number
          time?: string | null
          title: string
          updated_at?: string
          user_id: string
          weekdays?: number[]
        }
        Update: {
          created_at?: string
          description?: string | null
          due_at?: string | null
          frequency?: string
          id?: string
          last_completed_at?: string | null
          position?: number
          reminder_minutes?: number[]
          shop_id?: string
          streak?: number
          time?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "shop_routines_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_task_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "shop_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_task_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          task_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          task_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "shop_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_tasks: {
        Row: {
          assignee: string | null
          checklist: Json
          created_at: string
          description: string | null
          done_at: string | null
          due_at: string | null
          id: string
          parent_task_id: string | null
          position: number
          priority: string
          reminder_minutes: number[]
          shop_id: string
          source: string | null
          source_ref: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assignee?: string | null
          checklist?: Json
          created_at?: string
          description?: string | null
          done_at?: string | null
          due_at?: string | null
          id?: string
          parent_task_id?: string | null
          position?: number
          priority?: string
          reminder_minutes?: number[]
          shop_id: string
          source?: string | null
          source_ref?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assignee?: string | null
          checklist?: Json
          created_at?: string
          description?: string | null
          done_at?: string | null
          due_at?: string | null
          id?: string
          parent_task_id?: string | null
          position?: number
          priority?: string
          reminder_minutes?: number[]
          shop_id?: string
          source?: string | null
          source_ref?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "shop_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_tasks_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_connections: {
        Row: {
          access_token: string
          created_at: string
          id: string
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string
          name: string
          shop_domain: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string
          created_at?: string
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string
          name: string
          shop_domain: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string
          name?: string
          shop_domain?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shopify_oauth_states: {
        Row: {
          client_id: string | null
          client_secret: string | null
          created_at: string
          expires_at: string
          name: string
          shop_domain: string
          state: string
          user_id: string
        }
        Insert: {
          client_id?: string | null
          client_secret?: string | null
          created_at?: string
          expires_at?: string
          name: string
          shop_domain: string
          state: string
          user_id: string
        }
        Update: {
          client_id?: string | null
          client_secret?: string | null
          created_at?: string
          expires_at?: string
          name?: string
          shop_domain?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      shopify_stores: {
        Row: {
          access_token: string | null
          client_id: string | null
          client_secret: string | null
          created_at: string
          id: string
          installed_at: string | null
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          name: string | null
          scope: string | null
          shop_domain: string
          store_id: string | null
          token_secret_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string
          id?: string
          installed_at?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          name?: string | null
          scope?: string | null
          shop_domain: string
          store_id?: string | null
          token_secret_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string
          id?: string
          installed_at?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          name?: string | null
          scope?: string | null
          shop_domain?: string
          store_id?: string | null
          token_secret_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shops: {
        Row: {
          archived: boolean
          country: string | null
          created_at: string
          description: string | null
          group_id: string | null
          id: string
          logo_url: string | null
          name: string
          opening_balance: number
          pipeline_position: number
          pipeline_stage: string
          position: number
          status: string
          tag: string | null
          updated_at: string
          user_id: string
          weekend_payouts_to_monday: boolean
        }
        Insert: {
          archived?: boolean
          country?: string | null
          created_at?: string
          description?: string | null
          group_id?: string | null
          id?: string
          logo_url?: string | null
          name: string
          opening_balance?: number
          pipeline_position?: number
          pipeline_stage?: string
          position?: number
          status?: string
          tag?: string | null
          updated_at?: string
          user_id: string
          weekend_payouts_to_monday?: boolean
        }
        Update: {
          archived?: boolean
          country?: string | null
          created_at?: string
          description?: string | null
          group_id?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          opening_balance?: number
          pipeline_position?: number
          pipeline_stage?: string
          position?: number
          status?: string
          tag?: string | null
          updated_at?: string
          user_id?: string
          weekend_payouts_to_monday?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "shops_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "shop_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_edges: {
        Row: {
          created_at: string
          id: string
          process_id: string
          source_id: string
          target_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          process_id: string
          source_id: string
          target_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          process_id?: string
          source_id?: string
          target_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_edges_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "sop_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_edges_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sop_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_edges_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "sop_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_processes: {
        Row: {
          color: string
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_template: boolean
          layout_type: string
          name: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_template?: boolean
          layout_type?: string
          name?: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_template?: boolean
          layout_type?: string
          name?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sop_step_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          step_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          step_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          step_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_step_comments_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "sop_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_steps: {
        Row: {
          assignee: string | null
          attachments: Json
          checklist: Json
          color: string | null
          created_at: string
          description: string | null
          done_at: string | null
          id: string
          links: Json
          manual: boolean
          media: Json
          notes: string | null
          parent_id: string | null
          position: number
          process_id: string
          status: string
          title: string
          updated_at: string
          user_id: string
          x: number
          y: number
        }
        Insert: {
          assignee?: string | null
          attachments?: Json
          checklist?: Json
          color?: string | null
          created_at?: string
          description?: string | null
          done_at?: string | null
          id?: string
          links?: Json
          manual?: boolean
          media?: Json
          notes?: string | null
          parent_id?: string | null
          position?: number
          process_id: string
          status?: string
          title?: string
          updated_at?: string
          user_id: string
          x?: number
          y?: number
        }
        Update: {
          assignee?: string | null
          attachments?: Json
          checklist?: Json
          color?: string | null
          created_at?: string
          description?: string | null
          done_at?: string | null
          id?: string
          links?: Json
          manual?: boolean
          media?: Json
          notes?: string | null
          parent_id?: string | null
          position?: number
          process_id?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "sop_steps_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "sop_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_steps_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "sop_processes"
            referencedColumns: ["id"]
          },
        ]
      }
      store_revenues: {
        Row: {
          amount: number
          created_at: string
          date: string
          id: string
          store_id: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          date: string
          id?: string
          store_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_revenues_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          position: number
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          position?: number
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
          user_id?: string
        }
        Relationships: []
      }
      support_conversations: {
        Row: {
          assigned_to: string | null
          created_at: string
          customer_id: string
          first_customer_message_at: string | null
          first_response_at: string | null
          first_response_seconds: number | null
          id: string
          inbox_id: string
          is_unidentified: boolean
          last_message_at: string
          last_message_from: string
          linked_order_external_id: string | null
          linked_order_id: string | null
          shop_id: string
          status_id: string | null
          subject: string | null
          thread_key: string | null
          unread_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          customer_id: string
          first_customer_message_at?: string | null
          first_response_at?: string | null
          first_response_seconds?: number | null
          id?: string
          inbox_id: string
          is_unidentified?: boolean
          last_message_at?: string
          last_message_from?: string
          linked_order_external_id?: string | null
          linked_order_id?: string | null
          shop_id: string
          status_id?: string | null
          subject?: string | null
          thread_key?: string | null
          unread_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          customer_id?: string
          first_customer_message_at?: string | null
          first_response_at?: string | null
          first_response_seconds?: number | null
          id?: string
          inbox_id?: string
          is_unidentified?: boolean
          last_message_at?: string
          last_message_from?: string
          linked_order_external_id?: string | null
          linked_order_id?: string | null
          shop_id?: string
          status_id?: string | null
          subject?: string | null
          thread_key?: string | null
          unread_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "support_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "support_inboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_linked_order_id_fkey"
            columns: ["linked_order_id"]
            isOneToOne: false
            referencedRelation: "shop_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "support_ticket_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      support_customers: {
        Row: {
          created_at: string
          email: string
          id: string
          linked_shop_id: string | null
          name: string | null
          notes: string | null
          orders_count: number
          priority_tag: string | null
          total_spent: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          linked_shop_id?: string | null
          name?: string | null
          notes?: string | null
          orders_count?: number
          priority_tag?: string | null
          total_spent?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          linked_shop_id?: string | null
          name?: string | null
          notes?: string | null
          orders_count?: number
          priority_tag?: string | null
          total_spent?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_customers_linked_shop_id_fkey"
            columns: ["linked_shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      support_inboxes: {
        Row: {
          connection_status: string
          created_at: string
          display_name: string | null
          email_address: string
          id: string
          imap_host: string | null
          imap_password: string | null
          imap_port: number | null
          imap_ssl: boolean | null
          imap_user: string | null
          is_active: boolean
          last_error: string | null
          last_poll_at: string | null
          last_poll_error: string | null
          last_poll_status: string | null
          last_sync_at: string | null
          last_uid_seen: number | null
          poll_interval_sec: number
          provider: string
          shop_id: string
          sla_critical_hours: number
          sla_warning_hours: number
          smtp_host: string | null
          smtp_password: string | null
          smtp_port: number | null
          smtp_ssl: boolean | null
          smtp_user: string | null
          updated_at: string
          user_id: string
          webhook_secret: string
        }
        Insert: {
          connection_status?: string
          created_at?: string
          display_name?: string | null
          email_address: string
          id?: string
          imap_host?: string | null
          imap_password?: string | null
          imap_port?: number | null
          imap_ssl?: boolean | null
          imap_user?: string | null
          is_active?: boolean
          last_error?: string | null
          last_poll_at?: string | null
          last_poll_error?: string | null
          last_poll_status?: string | null
          last_sync_at?: string | null
          last_uid_seen?: number | null
          poll_interval_sec?: number
          provider?: string
          shop_id: string
          sla_critical_hours?: number
          sla_warning_hours?: number
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_ssl?: boolean | null
          smtp_user?: string | null
          updated_at?: string
          user_id: string
          webhook_secret?: string
        }
        Update: {
          connection_status?: string
          created_at?: string
          display_name?: string | null
          email_address?: string
          id?: string
          imap_host?: string | null
          imap_password?: string | null
          imap_port?: number | null
          imap_ssl?: boolean | null
          imap_user?: string | null
          is_active?: boolean
          last_error?: string | null
          last_poll_at?: string | null
          last_poll_error?: string | null
          last_poll_status?: string | null
          last_sync_at?: string | null
          last_uid_seen?: number | null
          poll_interval_sec?: number
          provider?: string
          shop_id?: string
          sla_critical_hours?: number
          sla_warning_hours?: number
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_ssl?: boolean | null
          smtp_user?: string | null
          updated_at?: string
          user_id?: string
          webhook_secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_inboxes_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          attachments: Json
          body_html: string | null
          body_text: string
          cc_emails: string[]
          conversation_id: string
          created_at: string
          direction: string
          error_message: string | null
          external_message_id: string | null
          from_email: string | null
          from_name: string | null
          id: string
          in_reply_to: string | null
          is_read: boolean
          references_header: string | null
          sent_at: string
          status: string
          subject: string | null
          to_emails: string[]
          user_id: string
        }
        Insert: {
          attachments?: Json
          body_html?: string | null
          body_text?: string
          cc_emails?: string[]
          conversation_id: string
          created_at?: string
          direction: string
          error_message?: string | null
          external_message_id?: string | null
          from_email?: string | null
          from_name?: string | null
          id?: string
          in_reply_to?: string | null
          is_read?: boolean
          references_header?: string | null
          sent_at?: string
          status?: string
          subject?: string | null
          to_emails?: string[]
          user_id: string
        }
        Update: {
          attachments?: Json
          body_html?: string | null
          body_text?: string
          cc_emails?: string[]
          conversation_id?: string
          created_at?: string
          direction?: string
          error_message?: string | null
          external_message_id?: string | null
          from_email?: string | null
          from_name?: string | null
          id?: string
          in_reply_to?: string | null
          is_read?: boolean
          references_header?: string | null
          sent_at?: string
          status?: string
          subject?: string | null
          to_emails?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_outbound_queue: {
        Row: {
          attempts: number
          body_html: string
          body_text: string
          cc_emails: string[]
          conversation_id: string
          created_at: string
          id: string
          in_reply_to: string | null
          inbox_id: string
          last_error: string | null
          message_id: string | null
          references_header: string | null
          sent_at: string | null
          status: string
          subject: string
          to_emails: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          body_html?: string
          body_text?: string
          cc_emails?: string[]
          conversation_id: string
          created_at?: string
          id?: string
          in_reply_to?: string | null
          inbox_id: string
          last_error?: string | null
          message_id?: string | null
          references_header?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          to_emails: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          body_html?: string
          body_text?: string
          cc_emails?: string[]
          conversation_id?: string
          created_at?: string
          id?: string
          in_reply_to?: string | null
          inbox_id?: string
          last_error?: string | null
          message_id?: string | null
          references_header?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          to_emails?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_outbound_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_outbound_queue_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "support_inboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_outbound_queue_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "support_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      support_reply_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          position: number
          shop_id: string | null
          shortcut: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          position?: number
          shop_id?: string | null
          shortcut?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          position?: number
          shop_id?: string | null
          shortcut?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_reply_templates_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_statuses: {
        Row: {
          color: string
          created_at: string
          id: string
          is_system: boolean
          name: string
          position: number
          system_key: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          position?: number
          system_key?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          position?: number
          system_key?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      task_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          task_id?: string
          user_id?: string
        }
        Relationships: []
      }
      task_completion_logs: {
        Row: {
          completed_at: string
          completed_on: string
          id: string
          task_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          completed_on?: string
          id?: string
          task_id: string
          user_id: string
        }
        Update: {
          completed_at?: string
          completed_on?: string
          id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: []
      }
      task_lists: {
        Row: {
          color: string
          created_at: string
          icon: string | null
          id: string
          is_system: boolean
          name: string
          position: number
          shop_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          icon?: string | null
          id?: string
          is_system?: boolean
          name: string
          position?: number
          shop_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          icon?: string | null
          id?: string
          is_system?: boolean
          name?: string
          position?: number
          shop_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_lists_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      task_notifications: {
        Row: {
          id: string
          kind: string
          minutes_before: number | null
          sent_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          id?: string
          kind: string
          minutes_before?: number | null
          sent_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          id?: string
          kind?: string
          minutes_before?: number | null
          sent_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          checklist: Json
          created_at: string
          description: string | null
          done: boolean
          done_at: string | null
          due_at: string | null
          id: string
          list_id: string | null
          position: number
          recurrence_frequency: string | null
          recurrence_time: string | null
          recurrence_weekdays: number[]
          reminder_minutes: number[]
          scheduled_date: string
          scheduled_time: string | null
          status: string
          tags: string[]
          title: string
          user_id: string
        }
        Insert: {
          checklist?: Json
          created_at?: string
          description?: string | null
          done?: boolean
          done_at?: string | null
          due_at?: string | null
          id?: string
          list_id?: string | null
          position?: number
          recurrence_frequency?: string | null
          recurrence_time?: string | null
          recurrence_weekdays?: number[]
          reminder_minutes?: number[]
          scheduled_date?: string
          scheduled_time?: string | null
          status?: string
          tags?: string[]
          title: string
          user_id: string
        }
        Update: {
          checklist?: Json
          created_at?: string
          description?: string | null
          done?: boolean
          done_at?: string | null
          due_at?: string | null
          id?: string
          list_id?: string | null
          position?: number
          recurrence_frequency?: string | null
          recurrence_time?: string | null
          recurrence_weekdays?: number[]
          reminder_minutes?: number[]
          scheduled_date?: string
          scheduled_time?: string | null
          status?: string
          tags?: string[]
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_list_id_fk"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "task_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      track123_event_rules: {
        Row: {
          created_at: string
          enabled: boolean
          event_key: string
          event_label: string
          id: string
          position: number
          shop_id: string
          target_status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          event_key: string
          event_label: string
          id?: string
          position?: number
          shop_id: string
          target_status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          event_key?: string
          event_label?: string
          id?: string
          position?: number
          shop_id?: string
          target_status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      track123_integrations: {
        Row: {
          api_key: string | null
          created_at: string
          enabled: boolean
          id: string
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          shop_id: string
          token: string | null
          tracking_link_template: string
          updated_at: string
          user_id: string
          webhook_secret: string
        }
        Insert: {
          api_key?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          shop_id: string
          token?: string | null
          tracking_link_template?: string
          updated_at?: string
          user_id: string
          webhook_secret?: string
        }
        Update: {
          api_key?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          shop_id?: string
          token?: string | null
          tracking_link_template?: string
          updated_at?: string
          user_id?: string
          webhook_secret?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          account_id: string
          amount: number
          category_id: string | null
          created_at: string
          currency: string
          date: string
          description: string | null
          external_id: string | null
          id: string
          import_source: string
          kind: string
          needs_review: boolean
          paid: boolean
          recurrence_id: string | null
          to_account_id: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          category_id?: string | null
          created_at?: string
          currency: string
          date?: string
          description?: string | null
          external_id?: string | null
          id?: string
          import_source?: string
          kind: string
          needs_review?: boolean
          paid?: boolean
          recurrence_id?: string | null
          to_account_id?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          category_id?: string | null
          created_at?: string
          currency?: string
          date?: string
          description?: string | null
          external_id?: string | null
          id?: string
          import_source?: string
          kind?: string
          needs_review?: boolean
          paid?: boolean
          recurrence_id?: string | null
          to_account_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_recurrence_id_fkey"
            columns: ["recurrence_id"]
            isOneToOne: false
            referencedRelation: "recurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
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
          role?: Database["public"]["Enums"]["app_role"]
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
      user_settings: {
        Row: {
          updated_at: string
          user_id: string
          whatsapp_enabled: boolean
          whatsapp_number: string | null
        }
        Insert: {
          updated_at?: string
          user_id: string
          whatsapp_enabled?: boolean
          whatsapp_number?: string | null
        }
        Update: {
          updated_at?: string
          user_id?: string
          whatsapp_enabled?: boolean
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      whiteboard_edges: {
        Row: {
          board_id: string
          color: string
          created_at: string
          id: string
          kind: string
          source_node_id: string
          target_node_id: string
          user_id: string
        }
        Insert: {
          board_id: string
          color?: string
          created_at?: string
          id?: string
          kind?: string
          source_node_id: string
          target_node_id: string
          user_id: string
        }
        Update: {
          board_id?: string
          color?: string
          created_at?: string
          id?: string
          kind?: string
          source_node_id?: string
          target_node_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whiteboard_edges_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "whiteboards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whiteboard_edges_source_node_id_fkey"
            columns: ["source_node_id"]
            isOneToOne: false
            referencedRelation: "whiteboard_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whiteboard_edges_target_node_id_fkey"
            columns: ["target_node_id"]
            isOneToOne: false
            referencedRelation: "whiteboard_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      whiteboard_nodes: {
        Row: {
          board_id: string
          created_at: string
          data: Json
          height: number | null
          id: string
          kind: string
          parent_id: string | null
          task_id: string | null
          updated_at: string
          user_id: string
          width: number | null
          x: number
          y: number
          z_index: number
        }
        Insert: {
          board_id: string
          created_at?: string
          data?: Json
          height?: number | null
          id?: string
          kind?: string
          parent_id?: string | null
          task_id?: string | null
          updated_at?: string
          user_id: string
          width?: number | null
          x?: number
          y?: number
          z_index?: number
        }
        Update: {
          board_id?: string
          created_at?: string
          data?: Json
          height?: number | null
          id?: string
          kind?: string
          parent_id?: string | null
          task_id?: string | null
          updated_at?: string
          user_id?: string
          width?: number | null
          x?: number
          y?: number
          z_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "whiteboard_nodes_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "whiteboards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whiteboard_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "whiteboard_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      whiteboards: {
        Row: {
          color: string
          created_at: string
          icon: string | null
          id: string
          is_favorite: boolean
          last_opened_at: string | null
          name: string
          position: number
          project_id: string | null
          updated_at: string
          user_id: string
          viewport: Json
        }
        Insert: {
          color?: string
          created_at?: string
          icon?: string | null
          id?: string
          is_favorite?: boolean
          last_opened_at?: string | null
          name?: string
          position?: number
          project_id?: string | null
          updated_at?: string
          user_id: string
          viewport?: Json
        }
        Update: {
          color?: string
          created_at?: string
          icon?: string | null
          id?: string
          is_favorite?: boolean
          last_opened_at?: string | null
          name?: string
          position?: number
          project_id?: string | null
          updated_at?: string
          user_id?: string
          viewport?: Json
        }
        Relationships: [
          {
            foreignKeyName: "whiteboards_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          member_id: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          owner_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_workspace_access: {
        Args: {
          _member: string
          _owner: string
          _resource?: string
          _section: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "member"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "member"],
    },
  },
} as const
