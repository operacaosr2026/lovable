export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      ai_batches: {
        Row: {
          batch_id: string;
          created_at: string;
          done_at: string | null;
          error: string | null;
          id: string;
          items: Json;
          kind: string;
          owner_id: string;
          status: string;
        };
        Insert: {
          batch_id: string;
          created_at?: string;
          done_at?: string | null;
          error?: string | null;
          id?: string;
          items?: Json;
          kind: string;
          owner_id: string;
          status?: string;
        };
        Update: {
          batch_id?: string;
          created_at?: string;
          done_at?: string | null;
          error?: string | null;
          id?: string;
          items?: Json;
          kind?: string;
          owner_id?: string;
          status?: string;
        };
        Relationships: [];
      };
      ai_usage: {
        Row: {
          batch: boolean;
          cache_read_tokens: number;
          cache_write_tokens: number;
          created_at: string;
          feature: string;
          id: number;
          input_tokens: number;
          model: string | null;
          output_tokens: number;
        };
        Insert: {
          batch?: boolean;
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          created_at?: string;
          feature: string;
          id?: number;
          input_tokens?: number;
          model?: string | null;
          output_tokens?: number;
        };
        Update: {
          batch?: boolean;
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          created_at?: string;
          feature?: string;
          id?: number;
          input_tokens?: number;
          model?: string | null;
          output_tokens?: number;
        };
        Relationships: [];
      };
      app_notifications: {
        Row: {
          body: string | null;
          created_at: string;
          dismissed_at: string | null;
          id: string;
          key: string;
          level: string;
          link: string | null;
          read_at: string | null;
          resolved_at: string | null;
          target_user_id: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          dismissed_at?: string | null;
          id?: string;
          key: string;
          level?: string;
          link?: string | null;
          read_at?: string | null;
          resolved_at?: string | null;
          target_user_id?: string | null;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          dismissed_at?: string | null;
          id?: string;
          key?: string;
          level?: string;
          link?: string | null;
          read_at?: string | null;
          resolved_at?: string | null;
          target_user_id?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          app_name: string;
          created_at: string;
          date_format: string;
          default_home: string;
          density: string;
          favicon_url: string | null;
          font_size: string;
          language: string;
          logo_url: string | null;
          primary_color: string;
          theme: string;
          timezone: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          app_name?: string;
          created_at?: string;
          date_format?: string;
          default_home?: string;
          density?: string;
          favicon_url?: string | null;
          font_size?: string;
          language?: string;
          logo_url?: string | null;
          primary_color?: string;
          theme?: string;
          timezone?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          app_name?: string;
          created_at?: string;
          date_format?: string;
          default_home?: string;
          density?: string;
          favicon_url?: string | null;
          font_size?: string;
          language?: string;
          logo_url?: string | null;
          primary_color?: string;
          theme?: string;
          timezone?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_id: string;
          created_at: string;
          data: Json | null;
          id: string;
          label: string;
          owner_id: string;
        };
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_id: string;
          created_at?: string;
          data?: Json | null;
          id?: string;
          label: string;
          owner_id: string;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_id?: string;
          created_at?: string;
          data?: Json | null;
          id?: string;
          label?: string;
          owner_id?: string;
        };
        Relationships: [];
      };
      bank_account_links: {
        Row: {
          account_id: string;
          connection_id: string;
          created_at: string;
          external_account_id: string;
          external_account_name: string | null;
          external_currency: string | null;
          id: string;
          last_external_uid: string | null;
          last_synced_at: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          connection_id: string;
          created_at?: string;
          external_account_id: string;
          external_account_name?: string | null;
          external_currency?: string | null;
          id?: string;
          last_external_uid?: string | null;
          last_synced_at?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          connection_id?: string;
          created_at?: string;
          external_account_id?: string;
          external_account_name?: string | null;
          external_currency?: string | null;
          id?: string;
          last_external_uid?: string | null;
          last_synced_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bank_account_links_connection_id_fkey";
            columns: ["connection_id"];
            isOneToOne: false;
            referencedRelation: "bank_connections";
            referencedColumns: ["id"];
          },
        ];
      };
      bank_connections: {
        Row: {
          access_token_encrypted: string;
          created_at: string;
          id: string;
          label: string;
          last_sync_at: string | null;
          last_sync_error: string | null;
          last_sync_status: string | null;
          provider: string;
          updated_at: string;
          user_id: string;
          wise_profile_id: string | null;
        };
        Insert: {
          access_token_encrypted: string;
          created_at?: string;
          id?: string;
          label: string;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string | null;
          provider: string;
          updated_at?: string;
          user_id: string;
          wise_profile_id?: string | null;
        };
        Update: {
          access_token_encrypted?: string;
          created_at?: string;
          id?: string;
          label?: string;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string | null;
          provider?: string;
          updated_at?: string;
          user_id?: string;
          wise_profile_id?: string | null;
        };
        Relationships: [];
      };
      caixa_daily_snapshots: {
        Row: {
          created_at: string;
          date: string;
          receivable: number;
          saldo: number;
          shop_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          date: string;
          receivable: number;
          saldo: number;
          shop_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          receivable?: number;
          saldo?: number;
          shop_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "caixa_daily_snapshots_shop_id_fkey";
            columns: ["shop_id"];
            isOneToOne: false;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
        ];
      };
      chargeback_alert_followups: {
        Row: {
          dunning_last_at: string | null;
          dunning_paused: boolean;
          dunning_replied_at: string | null;
          dunning_replied_step: number | null;
          dunning_started_at: string | null;
          dunning_step: number;
          dunning_stop_reason: string | null;
          excluded_at: string | null;
          excluded_by: string | null;
          excluded_reason: string | null;
          id: string;
          note: string | null;
          order_external_id: string;
          recovered_amount: number | null;
          recovered_at: string | null;
          recovered_step: number | null;
          recovery_draft_id: string | null;
          recovery_error: string | null;
          recovery_fulfilled: boolean;
          recovery_invoice_url: string | null;
          recovery_order_id: string | null;
          recovery_order_name: string | null;
          recovery_paid_at: string | null;
          shop_id: string;
          status: string;
          updated_at: string;
          updated_by: string | null;
          user_id: string;
        };
        Insert: {
          dunning_last_at?: string | null;
          dunning_paused?: boolean;
          dunning_replied_at?: string | null;
          dunning_replied_step?: number | null;
          dunning_started_at?: string | null;
          dunning_step?: number;
          dunning_stop_reason?: string | null;
          excluded_at?: string | null;
          excluded_by?: string | null;
          excluded_reason?: string | null;
          id?: string;
          note?: string | null;
          order_external_id: string;
          recovered_amount?: number | null;
          recovered_at?: string | null;
          recovered_step?: number | null;
          recovery_draft_id?: string | null;
          recovery_error?: string | null;
          recovery_fulfilled?: boolean;
          recovery_invoice_url?: string | null;
          recovery_order_id?: string | null;
          recovery_order_name?: string | null;
          recovery_paid_at?: string | null;
          shop_id: string;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          user_id: string;
        };
        Update: {
          dunning_last_at?: string | null;
          dunning_paused?: boolean;
          dunning_replied_at?: string | null;
          dunning_replied_step?: number | null;
          dunning_started_at?: string | null;
          dunning_step?: number;
          dunning_stop_reason?: string | null;
          excluded_at?: string | null;
          excluded_by?: string | null;
          excluded_reason?: string | null;
          id?: string;
          note?: string | null;
          order_external_id?: string;
          recovered_amount?: number | null;
          recovered_at?: string | null;
          recovered_step?: number | null;
          recovery_draft_id?: string | null;
          recovery_error?: string | null;
          recovery_fulfilled?: boolean;
          recovery_invoice_url?: string | null;
          recovery_order_id?: string | null;
          recovery_order_name?: string | null;
          recovery_paid_at?: string | null;
          shop_id?: string;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      chargeback_dunning_sends: {
        Row: {
          id: string;
          order_external_id: string;
          sent_at: string;
          shop_id: string;
          step: number;
          subject: string | null;
          user_id: string;
        };
        Insert: {
          id?: string;
          order_external_id: string;
          sent_at?: string;
          shop_id: string;
          step: number;
          subject?: string | null;
          user_id: string;
        };
        Update: {
          id?: string;
          order_external_id?: string;
          sent_at?: string;
          shop_id?: string;
          step?: number;
          subject?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      chargeback_settings: {
        Row: {
          dunning_enabled: boolean;
          dunning_final_wait_days: number;
          dunning_steps: Json;
          id: string;
          owner_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          dunning_enabled?: boolean;
          dunning_final_wait_days?: number;
          dunning_steps?: Json;
          id?: string;
          owner_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          dunning_enabled?: boolean;
          dunning_final_wait_days?: number;
          dunning_steps?: Json;
          id?: string;
          owner_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      company_goals: {
        Row: {
          created_at: string;
          frozen_at: string | null;
          id: string;
          lucro_por_venda: number | null;
          meta: number;
          month: string;
          realizado_final: number | null;
          shop_ids_final: string[] | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          frozen_at?: string | null;
          id?: string;
          lucro_por_venda?: number | null;
          meta: number;
          month: string;
          realizado_final?: number | null;
          shop_ids_final?: string[] | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          frozen_at?: string | null;
          id?: string;
          lucro_por_venda?: number | null;
          meta?: number;
          month?: string;
          realizado_final?: number | null;
          shop_ids_final?: string[] | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      competitor_templates: {
        Row: {
          created_at: string;
          fields: Json;
          id: string;
          is_default: boolean;
          name: string;
          position: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          fields?: Json;
          id?: string;
          is_default?: boolean;
          name: string;
          position?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          fields?: Json;
          id?: string;
          is_default?: boolean;
          name?: string;
          position?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      consultant_reports: {
        Row: {
          created_at: string;
          facts: Json;
          id: string;
          model: string | null;
          period_from: string;
          period_to: string;
          result: Json;
          tips_status: Json;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          facts: Json;
          id?: string;
          model?: string | null;
          period_from: string;
          period_to: string;
          result: Json;
          tips_status?: Json;
          user_id: string;
        };
        Update: {
          created_at?: string;
          facts?: Json;
          id?: string;
          model?: string | null;
          period_from?: string;
          period_to?: string;
          result?: Json;
          tips_status?: Json;
          user_id?: string;
        };
        Relationships: [];
      };
      consultant_settings: {
        Row: {
          context: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          context?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          context?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      cron_runs: {
        Row: {
          finished_at: string;
          id: number;
          job: string;
          ok: boolean;
          started_at: string;
          status: number | null;
          summary: string | null;
        };
        Insert: {
          finished_at?: string;
          id?: never;
          job: string;
          ok: boolean;
          started_at: string;
          status?: number | null;
          summary?: string | null;
        };
        Update: {
          finished_at?: string;
          id?: never;
          job?: string;
          ok?: boolean;
          started_at?: string;
          status?: number | null;
          summary?: string | null;
        };
        Relationships: [];
      };
      fix_rastreio_20261001_backup: {
        Row: {
          delivered_at: string | null;
          delivery_status: string | null;
          id: string | null;
          order_number: string | null;
          shipped_at: string | null;
        };
        Insert: {
          delivered_at?: string | null;
          delivery_status?: string | null;
          id?: string | null;
          order_number?: string | null;
          shipped_at?: string | null;
        };
        Update: {
          delivered_at?: string | null;
          delivery_status?: string | null;
          id?: string | null;
          order_number?: string | null;
          shipped_at?: string | null;
        };
        Relationships: [];
      };
      gerencial_alert_cache: {
        Row: {
          computed_at: string;
          critical_keys: string[];
          month: string;
          owner_id: string;
        };
        Insert: {
          computed_at?: string;
          critical_keys?: string[];
          month: string;
          owner_id: string;
        };
        Update: {
          computed_at?: string;
          critical_keys?: string[];
          month?: string;
          owner_id?: string;
        };
        Relationships: [];
      };
      gerencial_alert_dismissals: {
        Row: {
          alert_key: string;
          dismissed_at: string;
          dismissed_by: string | null;
          month: string;
          owner_id: string;
        };
        Insert: {
          alert_key: string;
          dismissed_at?: string;
          dismissed_by?: string | null;
          month: string;
          owner_id: string;
        };
        Update: {
          alert_key?: string;
          dismissed_at?: string;
          dismissed_by?: string | null;
          month?: string;
          owner_id?: string;
        };
        Relationships: [];
      };
      gratitude_entries: {
        Row: {
          content: string;
          created_at: string;
          date: string;
          id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          date: string;
          id?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          date?: string;
          id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      journal_pages: {
        Row: {
          content: string;
          created_at: string;
          icon: string | null;
          id: string;
          is_favorite: boolean;
          last_opened_at: string | null;
          parent_id: string | null;
          position: number;
          shop_id: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content?: string;
          created_at?: string;
          icon?: string | null;
          id?: string;
          is_favorite?: boolean;
          last_opened_at?: string | null;
          parent_id?: string | null;
          position?: number;
          shop_id?: string | null;
          title?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          icon?: string | null;
          id?: string;
          is_favorite?: boolean;
          last_opened_at?: string | null;
          parent_id?: string | null;
          position?: number;
          shop_id?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "journal_pages_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "journal_pages";
            referencedColumns: ["id"];
          },
        ];
      };
      kanban_columns: {
        Row: {
          board_id: string;
          board_type: string;
          color: string;
          created_at: string;
          id: string;
          key: string;
          label: string;
          position: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          board_id: string;
          board_type: string;
          color?: string;
          created_at?: string;
          id?: string;
          key: string;
          label: string;
          position?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          board_id?: string;
          board_type?: string;
          color?: string;
          created_at?: string;
          id?: string;
          key?: string;
          label?: string;
          position?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      lg_card_ad_spend: {
        Row: {
          amount: number;
          card_id: string;
          date: string;
          synced_at: string;
          user_id: string;
        };
        Insert: {
          amount?: number;
          card_id: string;
          date: string;
          synced_at?: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          card_id?: string;
          date?: string;
          synced_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lg_card_ad_spend_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "lg_cards";
            referencedColumns: ["id"];
          },
        ];
      };
      lg_card_currency_rates: {
        Row: {
          brl_rate: number;
          card_id: string;
          eur_rate: number;
          id: string;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          brl_rate?: number;
          card_id: string;
          eur_rate?: number;
          id?: string;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          brl_rate?: number;
          card_id?: string;
          eur_rate?: number;
          id?: string;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lg_card_currency_rates_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "lg_cards";
            referencedColumns: ["id"];
          },
        ];
      };
      lg_card_goals: {
        Row: {
          card_id: string;
          closed_at: string | null;
          created_at: string | null;
          id: string;
          lucro_por_venda: number | null;
          meta: number;
          prazo: string;
          start_date: string;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          card_id: string;
          closed_at?: string | null;
          created_at?: string | null;
          id?: string;
          lucro_por_venda?: number | null;
          meta: number;
          prazo: string;
          start_date: string;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          card_id?: string;
          closed_at?: string | null;
          created_at?: string | null;
          id?: string;
          lucro_por_venda?: number | null;
          meta?: number;
          prazo?: string;
          start_date?: string;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lg_card_goals_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "lg_cards";
            referencedColumns: ["id"];
          },
        ];
      };
      lg_card_meta_accounts: {
        Row: {
          account_name: string | null;
          ad_account_id: string;
          card_id: string;
          created_at: string;
          currency: string | null;
          enabled: boolean;
          id: string;
          last_sync_at: string | null;
          last_sync_error: string | null;
          last_sync_status: string | null;
          selected_campaign_ids: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_name?: string | null;
          ad_account_id: string;
          card_id: string;
          created_at?: string;
          currency?: string | null;
          enabled?: boolean;
          id?: string;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string | null;
          selected_campaign_ids?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_name?: string | null;
          ad_account_id?: string;
          card_id?: string;
          created_at?: string;
          currency?: string | null;
          enabled?: boolean;
          id?: string;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string | null;
          selected_campaign_ids?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lg_card_meta_accounts_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "lg_cards";
            referencedColumns: ["id"];
          },
        ];
      };
      lg_card_note_attachments: {
        Row: {
          created_at: string;
          file_name: string;
          file_path: string;
          id: string;
          mime_type: string | null;
          note_id: string;
          size_bytes: number | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          file_name: string;
          file_path: string;
          id?: string;
          mime_type?: string | null;
          note_id: string;
          size_bytes?: number | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          file_name?: string;
          file_path?: string;
          id?: string;
          mime_type?: string | null;
          note_id?: string;
          size_bytes?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lg_card_note_attachments_note_id_fkey";
            columns: ["note_id"];
            isOneToOne: false;
            referencedRelation: "lg_card_notes";
            referencedColumns: ["id"];
          },
        ];
      };
      lg_card_notes: {
        Row: {
          card_id: string;
          content: string;
          created_at: string | null;
          id: string;
          note_date: string;
          user_id: string;
          visitors: number | null;
        };
        Insert: {
          card_id: string;
          content: string;
          created_at?: string | null;
          id?: string;
          note_date?: string;
          user_id: string;
          visitors?: number | null;
        };
        Update: {
          card_id?: string;
          content?: string;
          created_at?: string | null;
          id?: string;
          note_date?: string;
          user_id?: string;
          visitors?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "lg_card_notes_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "lg_cards";
            referencedColumns: ["id"];
          },
        ];
      };
      lg_card_shops: {
        Row: {
          card_id: string;
          id: string;
          payment_days: number;
          payout_days: number;
          shop_id: string;
        };
        Insert: {
          card_id: string;
          id?: string;
          payment_days?: number;
          payout_days?: number;
          shop_id: string;
        };
        Update: {
          card_id?: string;
          id?: string;
          payment_days?: number;
          payout_days?: number;
          shop_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lg_card_shops_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "lg_cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lg_card_shops_shop_id_fkey";
            columns: ["shop_id"];
            isOneToOne: false;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
        ];
      };
      lg_cards: {
        Row: {
          country: string | null;
          created_at: string | null;
          description: string | null;
          id: string;
          inactive_since: string | null;
          logo_url: string | null;
          matriz_shop_id: string | null;
          name: string;
          status: string;
          tag: string | null;
          user_id: string;
        };
        Insert: {
          country?: string | null;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          inactive_since?: string | null;
          logo_url?: string | null;
          matriz_shop_id?: string | null;
          name: string;
          status?: string;
          tag?: string | null;
          user_id: string;
        };
        Update: {
          country?: string | null;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          inactive_since?: string | null;
          logo_url?: string | null;
          matriz_shop_id?: string | null;
          name?: string;
          status?: string;
          tag?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lg_cards_matriz_shop_id_fkey";
            columns: ["matriz_shop_id"];
            isOneToOne: false;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
        ];
      };
      login_history: {
        Row: {
          created_at: string;
          id: string;
          ip: string | null;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          ip?: string | null;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          ip?: string | null;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      member_invitations: {
        Row: {
          accepted_by: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          owner_id: string;
          permissions: Json;
          status: string;
          token: string;
        };
        Insert: {
          accepted_by?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          owner_id: string;
          permissions?: Json;
          status?: string;
          token: string;
        };
        Update: {
          accepted_by?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          owner_id?: string;
          permissions?: Json;
          status?: string;
          token?: string;
        };
        Relationships: [];
      };
      member_permissions: {
        Row: {
          created_at: string;
          id: string;
          member_id: string;
          owner_id: string;
          resource_id: string | null;
          section: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          member_id: string;
          owner_id: string;
          resource_id?: string | null;
          section: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          member_id?: string;
          owner_id?: string;
          resource_id?: string | null;
          section?: string;
        };
        Relationships: [];
      };
      mercury_category_rules: {
        Row: {
          created_at: string;
          enabled: boolean;
          id: string;
          match_field: string;
          match_type: string;
          match_value: string;
          position: number;
          shop_id: string;
          target_category: string;
          target_kind: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          id?: string;
          match_field?: string;
          match_type?: string;
          match_value: string;
          position?: number;
          shop_id: string;
          target_category: string;
          target_kind: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          id?: string;
          match_field?: string;
          match_type?: string;
          match_value?: string;
          position?: number;
          shop_id?: string;
          target_category?: string;
          target_kind?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      mercury_links: {
        Row: {
          cached_balance: number | null;
          cached_balance_at: string | null;
          created_at: string;
          id: string;
          last_sync_at: string | null;
          last_sync_error: string | null;
          last_sync_status: string | null;
          mercury_account_id: string;
          mercury_account_name: string | null;
          shop_id: string;
          sync_since: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cached_balance?: number | null;
          cached_balance_at?: string | null;
          created_at?: string;
          id?: string;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string | null;
          mercury_account_id: string;
          mercury_account_name?: string | null;
          shop_id: string;
          sync_since?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cached_balance?: number | null;
          cached_balance_at?: string | null;
          created_at?: string;
          id?: string;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string | null;
          mercury_account_id?: string;
          mercury_account_name?: string | null;
          shop_id?: string;
          sync_since?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      meta_ads_integrations: {
        Row: {
          access_token: string | null;
          account_name: string | null;
          ad_account_id: string | null;
          created_at: string;
          currency: string | null;
          enabled: boolean;
          id: string;
          journal_page_id: string | null;
          last_activities_sync_at: string | null;
          last_sync_at: string | null;
          last_sync_error: string | null;
          last_sync_status: string | null;
          shop_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          access_token?: string | null;
          account_name?: string | null;
          ad_account_id?: string | null;
          created_at?: string;
          currency?: string | null;
          enabled?: boolean;
          id?: string;
          journal_page_id?: string | null;
          last_activities_sync_at?: string | null;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string | null;
          shop_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          access_token?: string | null;
          account_name?: string | null;
          ad_account_id?: string | null;
          created_at?: string;
          currency?: string | null;
          enabled?: boolean;
          id?: string;
          journal_page_id?: string | null;
          last_activities_sync_at?: string | null;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string | null;
          shop_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "meta_ads_integrations_journal_page_id_fkey";
            columns: ["journal_page_id"];
            isOneToOne: false;
            referencedRelation: "journal_pages";
            referencedColumns: ["id"];
          },
        ];
      };
      meta_oauth_states: {
        Row: {
          created_at: string | null;
          expires_at: string;
          id: string;
          shop_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          expires_at?: string;
          id?: string;
          shop_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          expires_at?: string;
          id?: string;
          shop_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      notification_events: {
        Row: {
          created_at: string;
          key: string;
          owner_id: string;
        };
        Insert: {
          created_at?: string;
          key: string;
          owner_id: string;
        };
        Update: {
          created_at?: string;
          key?: string;
          owner_id?: string;
        };
        Relationships: [];
      };
      notification_settings: {
        Row: {
          dnd_enabled: boolean;
          dnd_end: string;
          dnd_start: string;
          muted_categories: string[];
          profit_times: string[];
          timezone: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          dnd_enabled?: boolean;
          dnd_end?: string;
          dnd_start?: string;
          muted_categories?: string[];
          profit_times?: string[];
          timezone?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          dnd_enabled?: boolean;
          dnd_end?: string;
          dnd_start?: string;
          muted_categories?: string[];
          profit_times?: string[];
          timezone?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      order_notice_templates: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          owner_id: string;
          position: number;
          subject: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          owner_id: string;
          position?: number;
          subject: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          owner_id?: string;
          position?: number;
          subject?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      order_notices: {
        Row: {
          body: string | null;
          error: string | null;
          id: string;
          order_id: string;
          owner_id: string;
          queued_at: string;
          sending_at: string | null;
          sent_at: string | null;
          sent_by: string | null;
          shop_id: string;
          status: string;
          subject: string;
          template_id: string | null;
          template_title: string;
          to_email: string;
        };
        Insert: {
          body?: string | null;
          error?: string | null;
          id?: string;
          order_id: string;
          owner_id: string;
          queued_at?: string;
          sending_at?: string | null;
          sent_at?: string | null;
          sent_by?: string | null;
          shop_id: string;
          status?: string;
          subject: string;
          template_id?: string | null;
          template_title: string;
          to_email: string;
        };
        Update: {
          body?: string | null;
          error?: string | null;
          id?: string;
          order_id?: string;
          owner_id?: string;
          queued_at?: string;
          sending_at?: string | null;
          sent_at?: string | null;
          sent_by?: string | null;
          shop_id?: string;
          status?: string;
          subject?: string;
          template_id?: string | null;
          template_title?: string;
          to_email?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_notices_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "shop_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_notices_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "order_notice_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      posting_holidays: {
        Row: {
          created_at: string | null;
          day: string;
          id: string;
          kind: string;
          name: string;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          day: string;
          id?: string;
          kind?: string;
          name?: string;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          day?: string;
          id?: string;
          kind?: string;
          name?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      product_ad_campaigns: {
        Row: {
          ad_account_id: string;
          campaign_id: string;
          campaign_name: string | null;
          created_at: string;
          id: string;
          product_id: string;
          shop_id: string;
          user_id: string;
        };
        Insert: {
          ad_account_id: string;
          campaign_id: string;
          campaign_name?: string | null;
          created_at?: string;
          id?: string;
          product_id: string;
          shop_id: string;
          user_id: string;
        };
        Update: {
          ad_account_id?: string;
          campaign_id?: string;
          campaign_name?: string | null;
          created_at?: string;
          id?: string;
          product_id?: string;
          shop_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_ad_campaigns_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_ad_campaigns_shop_id_fkey";
            columns: ["shop_id"];
            isOneToOne: false;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
        ];
      };
      product_board_columns: {
        Row: {
          color: string | null;
          created_at: string;
          id: string;
          name: string;
          position: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          position?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          position?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      product_checklist_items: {
        Row: {
          checked: boolean;
          created_at: string;
          id: string;
          position: number;
          product_id: string;
          text: string;
          user_id: string;
        };
        Insert: {
          checked?: boolean;
          created_at?: string;
          id?: string;
          position?: number;
          product_id: string;
          text: string;
          user_id: string;
        };
        Update: {
          checked?: boolean;
          created_at?: string;
          id?: string;
          position?: number;
          product_id?: string;
          text?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_checklist_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_competitors: {
        Row: {
          created_at: string;
          fields: Json;
          id: string;
          name: string;
          position: number;
          product_id: string;
          updated_at: string;
          user_id: string;
          values: Json;
        };
        Insert: {
          created_at?: string;
          fields?: Json;
          id?: string;
          name?: string;
          position?: number;
          product_id: string;
          updated_at?: string;
          user_id: string;
          values?: Json;
        };
        Update: {
          created_at?: string;
          fields?: Json;
          id?: string;
          name?: string;
          position?: number;
          product_id?: string;
          updated_at?: string;
          user_id?: string;
          values?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "product_competitors_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_cost_history: {
        Row: {
          cost: number;
          created_at: string;
          id: string;
          product_id: string;
          user_id: string;
          valid_from: string;
        };
        Insert: {
          cost: number;
          created_at?: string;
          id?: string;
          product_id: string;
          user_id: string;
          valid_from: string;
        };
        Update: {
          cost?: number;
          created_at?: string;
          id?: string;
          product_id?: string;
          user_id?: string;
          valid_from?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_cost_history_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_creatives: {
        Row: {
          created_at: string;
          description: string | null;
          descriptions: Json;
          id: string;
          media_kind: string | null;
          media_path: string | null;
          media_url: string | null;
          name: string;
          position: number;
          product_id: string;
          status: string;
          texts: Json;
          title: string;
          titles: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          descriptions?: Json;
          id?: string;
          media_kind?: string | null;
          media_path?: string | null;
          media_url?: string | null;
          name?: string;
          position?: number;
          product_id: string;
          status?: string;
          texts?: Json;
          title?: string;
          titles?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          descriptions?: Json;
          id?: string;
          media_kind?: string | null;
          media_path?: string | null;
          media_url?: string | null;
          name?: string;
          position?: number;
          product_id?: string;
          status?: string;
          texts?: Json;
          title?: string;
          titles?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_creatives_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_diary_entries: {
        Row: {
          author_id: string | null;
          content: string;
          created_at: string;
          edited_at: string | null;
          id: string;
          image_urls: Json;
          note_type_id: string | null;
          product_id: string;
          user_id: string;
        };
        Insert: {
          author_id?: string | null;
          content: string;
          created_at?: string;
          edited_at?: string | null;
          id?: string;
          image_urls?: Json;
          note_type_id?: string | null;
          product_id: string;
          user_id: string;
        };
        Update: {
          author_id?: string | null;
          content?: string;
          created_at?: string;
          edited_at?: string | null;
          id?: string;
          image_urls?: Json;
          note_type_id?: string | null;
          product_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_diary_entries_note_type_id_fkey";
            columns: ["note_type_id"];
            isOneToOne: false;
            referencedRelation: "product_diary_note_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_diary_entries_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_diary_focus: {
        Row: {
          current_test: string | null;
          product_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          current_test?: string | null;
          product_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          current_test?: string | null;
          product_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_diary_focus_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_diary_note_types: {
        Row: {
          color: string;
          created_at: string;
          id: string;
          is_system: boolean;
          name: string;
          position: number;
          user_id: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name: string;
          position?: number;
          user_id: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name?: string;
          position?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      product_doc_folders: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          position: number;
          product_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          position?: number;
          product_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          position?: number;
          product_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_doc_folders_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_docs: {
        Row: {
          content: string;
          created_at: string;
          folder_id: string | null;
          id: string;
          position: number;
          product_id: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content?: string;
          created_at?: string;
          folder_id?: string | null;
          id?: string;
          position?: number;
          product_id: string;
          title?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          folder_id?: string | null;
          id?: string;
          position?: number;
          product_id?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_docs_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "product_doc_folders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_docs_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_funnel_events: {
        Row: {
          client_id: string;
          created_at: string;
          day: string;
          id: number;
          shopify_product_id: string;
          shopify_store_id: string;
          step: string;
          title: string;
          user_id: string;
        };
        Insert: {
          client_id: string;
          created_at?: string;
          day: string;
          id?: never;
          shopify_product_id?: string;
          shopify_store_id: string;
          step: string;
          title?: string;
          user_id: string;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          day?: string;
          id?: never;
          shopify_product_id?: string;
          shopify_store_id?: string;
          step?: string;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_funnel_events_shopify_store_id_fkey";
            columns: ["shopify_store_id"];
            isOneToOne: false;
            referencedRelation: "shopify_stores";
            referencedColumns: ["id"];
          },
        ];
      };
      product_funnel_pages: {
        Row: {
          created_at: string;
          pagefly_page_id: string;
          product_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          pagefly_page_id: string;
          product_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          pagefly_page_id?: string;
          product_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_funnel_pages_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_images: {
        Row: {
          created_at: string;
          file_name: string | null;
          file_path: string;
          file_url: string | null;
          id: string;
          is_main: boolean;
          mime_type: string | null;
          position: number;
          product_id: string;
          size_bytes: number | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          file_name?: string | null;
          file_path: string;
          file_url?: string | null;
          id?: string;
          is_main?: boolean;
          mime_type?: string | null;
          position?: number;
          product_id: string;
          size_bytes?: number | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          file_name?: string | null;
          file_path?: string;
          file_url?: string | null;
          id?: string;
          is_main?: boolean;
          mime_type?: string | null;
          position?: number;
          product_id?: string;
          size_bytes?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_pages: {
        Row: {
          data: Json;
          product_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          data?: Json;
          product_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          data?: Json;
          product_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_pages_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_pricing: {
        Row: {
          dom_pagamentos_pct: number;
          imposto_pct: number;
          iof_pct: number;
          marketing_pct: number;
          payments_pct: number;
          product_id: string;
          retorno_chargeback_pct: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          dom_pagamentos_pct?: number;
          imposto_pct?: number;
          iof_pct?: number;
          marketing_pct?: number;
          payments_pct?: number;
          product_id: string;
          retorno_chargeback_pct?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          dom_pagamentos_pct?: number;
          imposto_pct?: number;
          iof_pct?: number;
          marketing_pct?: number;
          payments_pct?: number;
          product_id?: string;
          retorno_chargeback_pct?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_pricing_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_production: {
        Row: {
          product_id: string;
          updated_at: string;
          user_id: string;
          values: Json;
        };
        Insert: {
          product_id: string;
          updated_at?: string;
          user_id: string;
          values?: Json;
        };
        Update: {
          product_id?: string;
          updated_at?: string;
          user_id?: string;
          values?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "product_production_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_production_files: {
        Row: {
          created_at: string;
          id: string;
          mime: string | null;
          name: string;
          path: string;
          product_id: string;
          size: number;
          uploaded_by: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          mime?: string | null;
          name: string;
          path: string;
          product_id: string;
          size?: number;
          uploaded_by?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          mime?: string | null;
          name?: string;
          path?: string;
          product_id?: string;
          size?: number;
          uploaded_by?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_production_files_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_production_policies: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          position: number;
          product_id: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content?: string;
          created_at?: string;
          id?: string;
          position?: number;
          product_id: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          position?: number;
          product_id?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_production_policies_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_production_tasks: {
        Row: {
          assignee_id: string | null;
          checklist: Json;
          created_at: string;
          description: string | null;
          done: boolean;
          due_date: string | null;
          id: string;
          position: number;
          product_id: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          assignee_id?: string | null;
          checklist?: Json;
          created_at?: string;
          description?: string | null;
          done?: boolean;
          due_date?: string | null;
          id?: string;
          position?: number;
          product_id: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          assignee_id?: string | null;
          checklist?: Json;
          created_at?: string;
          description?: string | null;
          done?: boolean;
          due_date?: string | null;
          id?: string;
          position?: number;
          product_id?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_production_tasks_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_production_templates: {
        Row: {
          fields: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          fields?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          fields?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      product_shopify_listings: {
        Row: {
          data: Json;
          product_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          data?: Json;
          product_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          data?: Json;
          product_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_shopify_listings_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_shopify_links: {
        Row: {
          created_at: string;
          id: string;
          line_item_title: string | null;
          product_id: string;
          shopify_product_id: string | null;
          shopify_store_id: string;
          title: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          line_item_title?: string | null;
          product_id: string;
          shopify_product_id?: string | null;
          shopify_store_id: string;
          title?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          line_item_title?: string | null;
          product_id?: string;
          shopify_product_id?: string | null;
          shopify_store_id?: string;
          title?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      product_shopify_publications: {
        Row: {
          created_at: string;
          error: string | null;
          handle: string | null;
          id: string;
          product_id: string;
          role: string | null;
          shopify_product_id: string | null;
          shopify_store_id: string;
          status: string;
          updated_at: string;
          user_id: string;
          warnings: Json;
        };
        Insert: {
          created_at?: string;
          error?: string | null;
          handle?: string | null;
          id?: string;
          product_id: string;
          role?: string | null;
          shopify_product_id?: string | null;
          shopify_store_id: string;
          status: string;
          updated_at?: string;
          user_id: string;
          warnings?: Json;
        };
        Update: {
          created_at?: string;
          error?: string | null;
          handle?: string | null;
          id?: string;
          product_id?: string;
          role?: string | null;
          shopify_product_id?: string | null;
          shopify_store_id?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
          warnings?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "product_shopify_publications_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_shopify_publications_shopify_store_id_fkey";
            columns: ["shopify_store_id"];
            isOneToOne: false;
            referencedRelation: "shopify_stores";
            referencedColumns: ["id"];
          },
        ];
      };
      product_templates: {
        Row: {
          created_at: string;
          file_name: string | null;
          file_path: string | null;
          file_url: string | null;
          id: string;
          kind: string;
          mime_type: string | null;
          notes: string | null;
          pagefly_url: string | null;
          product_id: string;
          size_bytes: number | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          file_name?: string | null;
          file_path?: string | null;
          file_url?: string | null;
          id?: string;
          kind?: string;
          mime_type?: string | null;
          notes?: string | null;
          pagefly_url?: string | null;
          product_id: string;
          size_bytes?: number | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          file_name?: string | null;
          file_path?: string | null;
          file_url?: string | null;
          id?: string;
          kind?: string;
          mime_type?: string | null;
          notes?: string | null;
          pagefly_url?: string | null;
          product_id?: string;
          size_bytes?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_templates_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_variant_templates: {
        Row: {
          created_at: string;
          id: string;
          is_default: boolean;
          name: string;
          options: Json;
          position: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_default?: boolean;
          name: string;
          options?: Json;
          position?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_default?: boolean;
          name?: string;
          options?: Json;
          position?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          archived: boolean;
          board_column_id: string | null;
          board_position: number;
          cost: number;
          created_at: string;
          description: string | null;
          id: string;
          keywords: string[];
          main_image_url: string | null;
          name: string;
          niche: string | null;
          position: number;
          sale_price: number;
          status: string;
          supplier: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived?: boolean;
          board_column_id?: string | null;
          board_position?: number;
          cost?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          keywords?: string[];
          main_image_url?: string | null;
          name: string;
          niche?: string | null;
          position?: number;
          sale_price?: number;
          status?: string;
          supplier?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          archived?: boolean;
          board_column_id?: string | null;
          board_position?: number;
          cost?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          keywords?: string[];
          main_image_url?: string | null;
          name?: string;
          niche?: string | null;
          position?: number;
          sale_price?: number;
          status?: string;
          supplier?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_board_column_id_fkey";
            columns: ["board_column_id"];
            isOneToOne: false;
            referencedRelation: "product_board_columns";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      project_attachments: {
        Row: {
          created_at: string;
          file_name: string;
          file_path: string;
          id: string;
          mime_type: string | null;
          project_id: string;
          size_bytes: number | null;
          task_id: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          file_name: string;
          file_path: string;
          id?: string;
          mime_type?: string | null;
          project_id: string;
          size_bytes?: number | null;
          task_id?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          file_name?: string;
          file_path?: string;
          id?: string;
          mime_type?: string | null;
          project_id?: string;
          size_bytes?: number | null;
          task_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_attachments_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_notes: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          project_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          project_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          project_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_notes_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_tasks: {
        Row: {
          checklist: Json;
          created_at: string;
          description: string | null;
          due_at: string | null;
          id: string;
          parent_task_id: string | null;
          position: number;
          project_id: string;
          recurrence_frequency: string | null;
          recurrence_time: string | null;
          recurrence_weekdays: number[];
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          checklist?: Json;
          created_at?: string;
          description?: string | null;
          due_at?: string | null;
          id?: string;
          parent_task_id?: string | null;
          position?: number;
          project_id: string;
          recurrence_frequency?: string | null;
          recurrence_time?: string | null;
          recurrence_weekdays?: number[];
          status?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          checklist?: Json;
          created_at?: string;
          description?: string | null;
          due_at?: string | null;
          id?: string;
          parent_task_id?: string | null;
          position?: number;
          project_id?: string;
          recurrence_frequency?: string | null;
          recurrence_time?: string | null;
          recurrence_weekdays?: number[];
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_tasks_parent_task_id_fkey";
            columns: ["parent_task_id"];
            isOneToOne: false;
            referencedRelation: "project_tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_tasks_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          archived: boolean;
          category: string;
          color: string;
          created_at: string;
          description: string | null;
          due_date: string | null;
          id: string;
          name: string;
          position: number;
          priority: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived?: boolean;
          category?: string;
          color?: string;
          created_at?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          name: string;
          position?: number;
          priority?: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          archived?: boolean;
          category?: string;
          color?: string;
          created_at?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          name?: string;
          position?: number;
          priority?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      public_rate_limits: {
        Row: {
          at: string;
          bucket: string;
          id: number;
          ip: string;
        };
        Insert: {
          at?: string;
          bucket: string;
          id?: never;
          ip: string;
        };
        Update: {
          at?: string;
          bucket?: string;
          id?: never;
          ip?: string;
        };
        Relationships: [];
      };
      push_log: {
        Row: {
          created_at: string;
          error: string | null;
          id: string;
          notification_key: string | null;
          owner_id: string;
          status: string;
          subscription_id: string | null;
          title: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          error?: string | null;
          id?: string;
          notification_key?: string | null;
          owner_id: string;
          status: string;
          subscription_id?: string | null;
          title?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          error?: string | null;
          id?: string;
          notification_key?: string | null;
          owner_id?: string;
          status?: string;
          subscription_id?: string | null;
          title?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          device_label: string | null;
          disabled_at: string | null;
          endpoint: string;
          failure_count: number;
          id: string;
          last_used_at: string | null;
          owner_id: string;
          p256dh: string;
          user_id: string;
        };
        Insert: {
          auth: string;
          created_at?: string;
          device_label?: string | null;
          disabled_at?: string | null;
          endpoint: string;
          failure_count?: number;
          id?: string;
          last_used_at?: string | null;
          owner_id: string;
          p256dh: string;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          device_label?: string | null;
          disabled_at?: string | null;
          endpoint?: string;
          failure_count?: number;
          id?: string;
          last_used_at?: string | null;
          owner_id?: string;
          p256dh?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      shop_cash_categories: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          name: string;
          position: number;
          shop_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: string;
          name: string;
          position?: number;
          shop_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          name?: string;
          position?: number;
          shop_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      shop_cash_dismissed_payouts: {
        Row: {
          dismissed_at: string;
          shop_id: string;
          shopify_payout_id: string;
          user_id: string;
        };
        Insert: {
          dismissed_at?: string;
          shop_id: string;
          shopify_payout_id: string;
          user_id: string;
        };
        Update: {
          dismissed_at?: string;
          shop_id?: string;
          shopify_payout_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      shop_cash_entries: {
        Row: {
          amount: number;
          amount_locked: boolean;
          auto_kind: string | null;
          auto_ref_date: string | null;
          category: string | null;
          created_at: string;
          date: string;
          date_locked: boolean;
          description: string | null;
          id: string;
          import_id: string | null;
          kind: string;
          mercury_transaction_id: string | null;
          reconciled: boolean;
          recurrence: string;
          recurrence_until: string | null;
          shop_id: string;
          shopify_payout_id: string | null;
          shopify_payout_status: string | null;
          shopify_transaction_id: string | null;
          skip_weekend_rule: boolean;
          source: string;
          updated_at: string;
          user_id: string;
          via_balance: boolean;
        };
        Insert: {
          amount?: number;
          amount_locked?: boolean;
          auto_kind?: string | null;
          auto_ref_date?: string | null;
          category?: string | null;
          created_at?: string;
          date: string;
          date_locked?: boolean;
          description?: string | null;
          id?: string;
          import_id?: string | null;
          kind: string;
          mercury_transaction_id?: string | null;
          reconciled?: boolean;
          recurrence?: string;
          recurrence_until?: string | null;
          shop_id: string;
          shopify_payout_id?: string | null;
          shopify_payout_status?: string | null;
          shopify_transaction_id?: string | null;
          skip_weekend_rule?: boolean;
          source?: string;
          updated_at?: string;
          user_id: string;
          via_balance?: boolean;
        };
        Update: {
          amount?: number;
          amount_locked?: boolean;
          auto_kind?: string | null;
          auto_ref_date?: string | null;
          category?: string | null;
          created_at?: string;
          date?: string;
          date_locked?: boolean;
          description?: string | null;
          id?: string;
          import_id?: string | null;
          kind?: string;
          mercury_transaction_id?: string | null;
          reconciled?: boolean;
          recurrence?: string;
          recurrence_until?: string | null;
          shop_id?: string;
          shopify_payout_id?: string | null;
          shopify_payout_status?: string | null;
          shopify_transaction_id?: string | null;
          skip_weekend_rule?: boolean;
          source?: string;
          updated_at?: string;
          user_id?: string;
          via_balance?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "shop_cash_entries_import_id_fkey";
            columns: ["import_id"];
            isOneToOne: false;
            referencedRelation: "shop_cash_imports";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_cash_imports: {
        Row: {
          created_at: string;
          file_hash: string | null;
          file_name: string;
          id: string;
          shop_id: string;
          total_amount: number;
          total_rows: number;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          file_hash?: string | null;
          file_name: string;
          id?: string;
          shop_id: string;
          total_amount?: number;
          total_rows?: number;
          user_id: string;
        };
        Update: {
          created_at?: string;
          file_hash?: string | null;
          file_name?: string;
          id?: string;
          shop_id?: string;
          total_amount?: number;
          total_rows?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      shop_cash_overrides: {
        Row: {
          amount: number;
          category: string | null;
          created_at: string;
          date: string;
          deleted: boolean;
          description: string | null;
          id: string;
          kind: string;
          reconciled: boolean;
          recurrence: string;
          recurrence_until: string | null;
          shop_id: string;
          skip_weekend_rule: boolean;
          source_entry_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount?: number;
          category?: string | null;
          created_at?: string;
          date: string;
          deleted?: boolean;
          description?: string | null;
          id?: string;
          kind: string;
          reconciled?: boolean;
          recurrence?: string;
          recurrence_until?: string | null;
          shop_id: string;
          skip_weekend_rule?: boolean;
          source_entry_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          category?: string | null;
          created_at?: string;
          date?: string;
          deleted?: boolean;
          description?: string | null;
          id?: string;
          kind?: string;
          reconciled?: boolean;
          recurrence?: string;
          recurrence_until?: string | null;
          shop_id?: string;
          skip_weekend_rule?: boolean;
          source_entry_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_cash_overrides_source_entry_id_fkey";
            columns: ["source_entry_id"];
            isOneToOne: false;
            referencedRelation: "shop_cash_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_daily_analytics: {
        Row: {
          date: string;
          id: string;
          sessions: number;
          shop_id: string;
          user_id: string;
        };
        Insert: {
          date: string;
          id?: string;
          sessions?: number;
          shop_id: string;
          user_id: string;
        };
        Update: {
          date?: string;
          id?: string;
          sessions?: number;
          shop_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_daily_analytics_shop_id_fkey";
            columns: ["shop_id"];
            isOneToOne: false;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_group_stores: {
        Row: {
          created_at: string | null;
          group_id: string;
          id: string;
          role: string;
          shopify_store_id: string;
        };
        Insert: {
          created_at?: string | null;
          group_id: string;
          id?: string;
          role?: string;
          shopify_store_id: string;
        };
        Update: {
          created_at?: string | null;
          group_id?: string;
          id?: string;
          role?: string;
          shopify_store_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_group_stores_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "shop_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shop_group_stores_shopify_store_id_fkey";
            columns: ["shopify_store_id"];
            isOneToOne: false;
            referencedRelation: "shopify_stores";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_groups: {
        Row: {
          country: string | null;
          created_at: string | null;
          description: string | null;
          id: string;
          logo_url: string | null;
          name: string;
          status: string;
          tag: string | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          country?: string | null;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          logo_url?: string | null;
          name: string;
          status?: string;
          tag?: string | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          country?: string | null;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          logo_url?: string | null;
          name?: string;
          status?: string;
          tag?: string | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      shop_meta_ad_accounts: {
        Row: {
          account_name: string | null;
          account_status: number | null;
          account_status_at: string | null;
          ad_account_id: string;
          billing_seen_tx: string[];
          billing_started_at: string | null;
          billing_synced_until: string | null;
          created_at: string | null;
          currency: string | null;
          enabled: boolean;
          id: string;
          last_activities_sync_at: string | null;
          last_sync_at: string | null;
          last_sync_error: string | null;
          last_sync_status: string | null;
          selected_campaign_ids: Json | null;
          shop_id: string;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          account_name?: string | null;
          account_status?: number | null;
          account_status_at?: string | null;
          ad_account_id: string;
          billing_seen_tx?: string[];
          billing_started_at?: string | null;
          billing_synced_until?: string | null;
          created_at?: string | null;
          currency?: string | null;
          enabled?: boolean;
          id?: string;
          last_activities_sync_at?: string | null;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string | null;
          selected_campaign_ids?: Json | null;
          shop_id: string;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          account_name?: string | null;
          account_status?: number | null;
          account_status_at?: string | null;
          ad_account_id?: string;
          billing_seen_tx?: string[];
          billing_started_at?: string | null;
          billing_synced_until?: string | null;
          created_at?: string | null;
          currency?: string | null;
          enabled?: boolean;
          id?: string;
          last_activities_sync_at?: string | null;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string | null;
          selected_campaign_ids?: Json | null;
          shop_id?: string;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      shop_meta_tokens: {
        Row: {
          access_token: string;
          activities_journal_page_id: string | null;
          ad_accounts: Json | null;
          created_at: string | null;
          fb_user_id: string | null;
          fb_user_name: string | null;
          id: string;
          selected_ad_account_id: string | null;
          selected_campaign_ids: Json | null;
          shop_id: string;
          token_expires_at: string | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          access_token: string;
          activities_journal_page_id?: string | null;
          ad_accounts?: Json | null;
          created_at?: string | null;
          fb_user_id?: string | null;
          fb_user_name?: string | null;
          id?: string;
          selected_ad_account_id?: string | null;
          selected_campaign_ids?: Json | null;
          shop_id: string;
          token_expires_at?: string | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          access_token?: string;
          activities_journal_page_id?: string | null;
          ad_accounts?: Json | null;
          created_at?: string | null;
          fb_user_id?: string | null;
          fb_user_name?: string | null;
          id?: string;
          selected_ad_account_id?: string | null;
          selected_campaign_ids?: Json | null;
          shop_id?: string;
          token_expires_at?: string | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      shop_order_disputes: {
        Row: {
          amount: number;
          created_at: string;
          currency: string | null;
          evidence_due_by: string | null;
          finalized_on: string | null;
          id: string;
          initiated_at: string;
          order_external_id: string | null;
          order_snapshot: Json | null;
          order_snapshot_at: string | null;
          reason: string | null;
          shop_id: string;
          shopify_dispute_id: string;
          status: string | null;
          type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount?: number;
          created_at?: string;
          currency?: string | null;
          evidence_due_by?: string | null;
          finalized_on?: string | null;
          id?: string;
          initiated_at: string;
          order_external_id?: string | null;
          order_snapshot?: Json | null;
          order_snapshot_at?: string | null;
          reason?: string | null;
          shop_id: string;
          shopify_dispute_id: string;
          status?: string | null;
          type: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          currency?: string | null;
          evidence_due_by?: string | null;
          finalized_on?: string | null;
          id?: string;
          initiated_at?: string;
          order_external_id?: string | null;
          order_snapshot?: Json | null;
          order_snapshot_at?: string | null;
          reason?: string | null;
          shop_id?: string;
          shopify_dispute_id?: string;
          status?: string | null;
          type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      shop_order_payment_batches: {
        Row: {
          batch_number: number;
          cash_entry_id: string | null;
          created_at: string;
          description: string | null;
          id: string;
          order_dates: string[];
          payment_date: string;
          shop_id: string;
          total_amount: number;
          total_items: number;
          total_orders: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          batch_number: number;
          cash_entry_id?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          order_dates?: string[];
          payment_date: string;
          shop_id: string;
          total_amount?: number;
          total_items?: number;
          total_orders?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          batch_number?: number;
          cash_entry_id?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          order_dates?: string[];
          payment_date?: string;
          shop_id?: string;
          total_amount?: number;
          total_items?: number;
          total_orders?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      shop_order_risks: {
        Row: {
          facts: Json;
          financial_status: string | null;
          id: string;
          order_created_at: string | null;
          order_external_id: string;
          order_name: string | null;
          payment_brand: string | null;
          recommendation: string | null;
          risk_level: string | null;
          shop_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          facts?: Json;
          financial_status?: string | null;
          id?: string;
          order_created_at?: string | null;
          order_external_id: string;
          order_name?: string | null;
          payment_brand?: string | null;
          recommendation?: string | null;
          risk_level?: string | null;
          shop_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          facts?: Json;
          financial_status?: string | null;
          id?: string;
          order_created_at?: string | null;
          order_external_id?: string;
          order_name?: string | null;
          payment_brand?: string | null;
          recommendation?: string | null;
          risk_level?: string | null;
          shop_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      shop_order_settings: {
        Row: {
          automation_enabled: boolean;
          cashflow_start_date: string | null;
          chargeback_count_30d: number | null;
          chargeback_count_prev: number | null;
          chargeback_orders_30d: number | null;
          chargeback_orders_prev: number | null;
          chargeback_stats_at: string | null;
          created_at: string;
          default_unit_cost: number;
          last_synced_at: string | null;
          linked_product_id: string | null;
          payout_lag_avg_days: number | null;
          payout_lag_days: number | null;
          payout_lag_sample_size: number | null;
          processing_delay_days: number;
          shop_id: string;
          shopify_store_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          automation_enabled?: boolean;
          cashflow_start_date?: string | null;
          chargeback_count_30d?: number | null;
          chargeback_count_prev?: number | null;
          chargeback_orders_30d?: number | null;
          chargeback_orders_prev?: number | null;
          chargeback_stats_at?: string | null;
          created_at?: string;
          default_unit_cost?: number;
          last_synced_at?: string | null;
          linked_product_id?: string | null;
          payout_lag_avg_days?: number | null;
          payout_lag_days?: number | null;
          payout_lag_sample_size?: number | null;
          processing_delay_days?: number;
          shop_id: string;
          shopify_store_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          automation_enabled?: boolean;
          cashflow_start_date?: string | null;
          chargeback_count_30d?: number | null;
          chargeback_count_prev?: number | null;
          chargeback_orders_30d?: number | null;
          chargeback_orders_prev?: number | null;
          chargeback_stats_at?: string | null;
          created_at?: string;
          default_unit_cost?: number;
          last_synced_at?: string | null;
          linked_product_id?: string | null;
          payout_lag_avg_days?: number | null;
          payout_lag_days?: number | null;
          payout_lag_sample_size?: number | null;
          processing_delay_days?: number;
          shop_id?: string;
          shopify_store_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      shop_order_tracking: {
        Row: {
          carrier: string | null;
          created_at: string;
          delivered_at: string | null;
          edd_from: string | null;
          edd_source: string | null;
          edd_to: string | null;
          extra_packages: Json;
          id: string;
          last_event_at: string | null;
          last_event_label: string | null;
          order_id: string;
          problem_at: string | null;
          provider: string | null;
          registered_17track_at: string | null;
          shipped_at: string | null;
          shop_id: string;
          timeline: Json;
          tracking_number: string | null;
          tracking_status: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          carrier?: string | null;
          created_at?: string;
          delivered_at?: string | null;
          edd_from?: string | null;
          edd_source?: string | null;
          edd_to?: string | null;
          extra_packages?: Json;
          id?: string;
          last_event_at?: string | null;
          last_event_label?: string | null;
          order_id: string;
          problem_at?: string | null;
          provider?: string | null;
          registered_17track_at?: string | null;
          shipped_at?: string | null;
          shop_id: string;
          timeline?: Json;
          tracking_number?: string | null;
          tracking_status?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          carrier?: string | null;
          created_at?: string;
          delivered_at?: string | null;
          edd_from?: string | null;
          edd_source?: string | null;
          edd_to?: string | null;
          extra_packages?: Json;
          id?: string;
          last_event_at?: string | null;
          last_event_label?: string | null;
          order_id?: string;
          problem_at?: string | null;
          provider?: string | null;
          registered_17track_at?: string | null;
          shipped_at?: string | null;
          shop_id?: string;
          timeline?: Json;
          tracking_number?: string | null;
          tracking_status?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_order_tracking_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "shop_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_orders: {
        Row: {
          carrier: string | null;
          connection_id: string | null;
          created_at: string;
          created_at_shopify: string;
          currency: string | null;
          customer_notified_at: string | null;
          delivered_at: string | null;
          delivery_status: string | null;
          external_id: string;
          id: string;
          items_count: number;
          kpi_excluded: boolean;
          logistics_note: string | null;
          notice_note: string | null;
          order_date: string;
          order_number: string | null;
          paid_at: string | null;
          payment_batch_id: string | null;
          payment_status: string;
          problem_at: string | null;
          raw: Json | null;
          revenue: number;
          shipped_at: string | null;
          shop_id: string;
          shopify_financial_status: string | null;
          source: string;
          tracking_code: string | null;
          tracking_code_manual_at: string | null;
          tracking_code_history: Json;
          tracking_url: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          carrier?: string | null;
          connection_id?: string | null;
          created_at?: string;
          created_at_shopify: string;
          currency?: string | null;
          customer_notified_at?: string | null;
          delivered_at?: string | null;
          delivery_status?: string | null;
          external_id: string;
          id?: string;
          items_count?: number;
          kpi_excluded?: boolean;
          logistics_note?: string | null;
          notice_note?: string | null;
          order_date: string;
          order_number?: string | null;
          paid_at?: string | null;
          payment_batch_id?: string | null;
          payment_status?: string;
          problem_at?: string | null;
          raw?: Json | null;
          revenue?: number;
          shipped_at?: string | null;
          shop_id: string;
          shopify_financial_status?: string | null;
          source?: string;
          tracking_code?: string | null;
          tracking_code_manual_at?: string | null;
          tracking_code_history?: Json;
          tracking_url?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          carrier?: string | null;
          connection_id?: string | null;
          created_at?: string;
          created_at_shopify?: string;
          currency?: string | null;
          customer_notified_at?: string | null;
          delivered_at?: string | null;
          delivery_status?: string | null;
          external_id?: string;
          id?: string;
          items_count?: number;
          kpi_excluded?: boolean;
          logistics_note?: string | null;
          notice_note?: string | null;
          order_date?: string;
          order_number?: string | null;
          paid_at?: string | null;
          payment_batch_id?: string | null;
          payment_status?: string;
          problem_at?: string | null;
          raw?: Json | null;
          revenue?: number;
          shipped_at?: string | null;
          shop_id?: string;
          shopify_financial_status?: string | null;
          source?: string;
          tracking_code?: string | null;
          tracking_code_manual_at?: string | null;
          tracking_code_history?: Json;
          tracking_url?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_orders_connection_id_fkey";
            columns: ["connection_id"];
            isOneToOne: false;
            referencedRelation: "shopify_connections";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_product_attachments: {
        Row: {
          created_at: string;
          file_name: string;
          file_path: string;
          id: string;
          mime_type: string | null;
          product_id: string;
          size_bytes: number | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          file_name: string;
          file_path: string;
          id?: string;
          mime_type?: string | null;
          product_id: string;
          size_bytes?: number | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          file_name?: string;
          file_path?: string;
          id?: string;
          mime_type?: string | null;
          product_id?: string;
          size_bytes?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_product_attachments_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "shop_products";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_product_cost_history: {
        Row: {
          created_at: string;
          id: string;
          note: string | null;
          shop_id: string;
          unit_cost: number;
          user_id: string;
          valid_from: string | null;
          valid_to: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          note?: string | null;
          shop_id: string;
          unit_cost: number;
          user_id: string;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          note?: string | null;
          shop_id?: string;
          unit_cost?: number;
          user_id?: string;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Relationships: [];
      };
      shop_products: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          image_url: string | null;
          links: Json;
          name: string;
          notes: string | null;
          position: number;
          product_date: string | null;
          product_id: string | null;
          shop_id: string;
          status: string;
          tags: string[];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          links?: Json;
          name: string;
          notes?: string | null;
          position?: number;
          product_date?: string | null;
          product_id?: string | null;
          shop_id: string;
          status?: string;
          tags?: string[];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          links?: Json;
          name?: string;
          notes?: string | null;
          position?: number;
          product_date?: string | null;
          product_id?: string | null;
          shop_id?: string;
          status?: string;
          tags?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_products_shop_id_fkey";
            columns: ["shop_id"];
            isOneToOne: false;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_profit_goals: {
        Row: {
          created_at: string;
          currency: string;
          daily_budget: number;
          end_date: string;
          fees_pct: number;
          id: string;
          max_cpa: number;
          sale_price: number;
          shop_id: string;
          start_date: string;
          supplier_cost: number;
          target_profit: number;
          total_marketing: number;
          total_revenue: number;
          total_sales: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          daily_budget?: number;
          end_date?: string;
          fees_pct?: number;
          id?: string;
          max_cpa?: number;
          sale_price?: number;
          shop_id: string;
          start_date?: string;
          supplier_cost?: number;
          target_profit?: number;
          total_marketing?: number;
          total_revenue?: number;
          total_sales?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          daily_budget?: number;
          end_date?: string;
          fees_pct?: number;
          id?: string;
          max_cpa?: number;
          sale_price?: number;
          shop_id?: string;
          start_date?: string;
          supplier_cost?: number;
          target_profit?: number;
          total_marketing?: number;
          total_revenue?: number;
          total_sales?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      shop_routine_logs: {
        Row: {
          completed_at: string;
          completed_on: string;
          id: string;
          routine_id: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string;
          completed_on?: string;
          id?: string;
          routine_id: string;
          user_id: string;
        };
        Update: {
          completed_at?: string;
          completed_on?: string;
          id?: string;
          routine_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_routine_logs_routine_id_fkey";
            columns: ["routine_id"];
            isOneToOne: false;
            referencedRelation: "shop_routines";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_routines: {
        Row: {
          created_at: string;
          description: string | null;
          due_at: string | null;
          frequency: string;
          id: string;
          last_completed_at: string | null;
          position: number;
          reminder_minutes: number[];
          shop_id: string;
          streak: number;
          time: string | null;
          title: string;
          updated_at: string;
          user_id: string;
          weekdays: number[];
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          due_at?: string | null;
          frequency?: string;
          id?: string;
          last_completed_at?: string | null;
          position?: number;
          reminder_minutes?: number[];
          shop_id: string;
          streak?: number;
          time?: string | null;
          title: string;
          updated_at?: string;
          user_id: string;
          weekdays?: number[];
        };
        Update: {
          created_at?: string;
          description?: string | null;
          due_at?: string | null;
          frequency?: string;
          id?: string;
          last_completed_at?: string | null;
          position?: number;
          reminder_minutes?: number[];
          shop_id?: string;
          streak?: number;
          time?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
          weekdays?: number[];
        };
        Relationships: [
          {
            foreignKeyName: "shop_routines_shop_id_fkey";
            columns: ["shop_id"];
            isOneToOne: false;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_task_attachments: {
        Row: {
          created_at: string;
          file_name: string;
          file_path: string;
          id: string;
          mime_type: string | null;
          size_bytes: number | null;
          task_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          file_name: string;
          file_path: string;
          id?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          task_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          file_name?: string;
          file_path?: string;
          id?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          task_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_task_attachments_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "shop_tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_task_comments: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          task_id: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          task_id: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          task_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_task_comments_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "shop_tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      shop_tasks: {
        Row: {
          assignee: string | null;
          checklist: Json;
          created_at: string;
          description: string | null;
          done_at: string | null;
          due_at: string | null;
          id: string;
          parent_task_id: string | null;
          position: number;
          priority: string;
          reminder_minutes: number[];
          shop_id: string;
          source: string | null;
          source_ref: string | null;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          assignee?: string | null;
          checklist?: Json;
          created_at?: string;
          description?: string | null;
          done_at?: string | null;
          due_at?: string | null;
          id?: string;
          parent_task_id?: string | null;
          position?: number;
          priority?: string;
          reminder_minutes?: number[];
          shop_id: string;
          source?: string | null;
          source_ref?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          assignee?: string | null;
          checklist?: Json;
          created_at?: string;
          description?: string | null;
          done_at?: string | null;
          due_at?: string | null;
          id?: string;
          parent_task_id?: string | null;
          position?: number;
          priority?: string;
          reminder_minutes?: number[];
          shop_id?: string;
          source?: string | null;
          source_ref?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shop_tasks_parent_task_id_fkey";
            columns: ["parent_task_id"];
            isOneToOne: false;
            referencedRelation: "shop_tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shop_tasks_shop_id_fkey";
            columns: ["shop_id"];
            isOneToOne: false;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
        ];
      };
      shopify_connections: {
        Row: {
          access_token: string;
          created_at: string;
          id: string;
          last_sync_at: string | null;
          last_sync_error: string | null;
          last_sync_status: string;
          name: string;
          shop_domain: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          access_token?: string;
          created_at?: string;
          id?: string;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string;
          name: string;
          shop_domain: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          access_token?: string;
          created_at?: string;
          id?: string;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string;
          name?: string;
          shop_domain?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      shopify_oauth_states: {
        Row: {
          client_id: string | null;
          client_secret: string | null;
          created_at: string;
          expires_at: string;
          name: string;
          replace_placeholder_id: string | null;
          shop_domain: string;
          state: string;
          user_id: string;
        };
        Insert: {
          client_id?: string | null;
          client_secret?: string | null;
          created_at?: string;
          expires_at?: string;
          name: string;
          replace_placeholder_id?: string | null;
          shop_domain: string;
          state: string;
          user_id: string;
        };
        Update: {
          client_id?: string | null;
          client_secret?: string | null;
          created_at?: string;
          expires_at?: string;
          name?: string;
          replace_placeholder_id?: string | null;
          shop_domain?: string;
          state?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      shopify_stores: {
        Row: {
          access_token: string | null;
          board_avg_orders: number | null;
          board_column_id: string | null;
          board_metrics_at: string | null;
          board_note: string | null;
          board_payout_days: number | null;
          board_position: number;
          client_id: string | null;
          client_secret: string | null;
          created_at: string;
          iana_timezone: string | null;
          id: string;
          installed_at: string | null;
          is_placeholder: boolean;
          last_sync_at: string | null;
          last_sync_error: string | null;
          last_sync_status: string | null;
          name: string | null;
          payments_balance: number | null;
          payments_balance_at: string | null;
          payments_balance_currency: string | null;
          policy_base: boolean;
          scope: string | null;
          setup_check_until: string | null;
          shop_domain: string | null;
          store_id: string | null;
          token_secret_name: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          access_token?: string | null;
          board_avg_orders?: number | null;
          board_column_id?: string | null;
          board_metrics_at?: string | null;
          board_note?: string | null;
          board_payout_days?: number | null;
          board_position?: number;
          client_id?: string | null;
          client_secret?: string | null;
          created_at?: string;
          iana_timezone?: string | null;
          id?: string;
          installed_at?: string | null;
          is_placeholder?: boolean;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string | null;
          name?: string | null;
          payments_balance?: number | null;
          payments_balance_at?: string | null;
          payments_balance_currency?: string | null;
          policy_base?: boolean;
          scope?: string | null;
          setup_check_until?: string | null;
          shop_domain?: string | null;
          store_id?: string | null;
          token_secret_name?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          access_token?: string | null;
          board_avg_orders?: number | null;
          board_column_id?: string | null;
          board_metrics_at?: string | null;
          board_note?: string | null;
          board_payout_days?: number | null;
          board_position?: number;
          client_id?: string | null;
          client_secret?: string | null;
          created_at?: string;
          iana_timezone?: string | null;
          id?: string;
          installed_at?: string | null;
          is_placeholder?: boolean;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string | null;
          name?: string | null;
          payments_balance?: number | null;
          payments_balance_at?: string | null;
          payments_balance_currency?: string | null;
          policy_base?: boolean;
          scope?: string | null;
          setup_check_until?: string | null;
          shop_domain?: string | null;
          store_id?: string | null;
          token_secret_name?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shopify_stores_board_column_id_fkey";
            columns: ["board_column_id"];
            isOneToOne: false;
            referencedRelation: "store_board_columns";
            referencedColumns: ["id"];
          },
        ];
      };
      shops: {
        Row: {
          archived: boolean;
          country: string | null;
          created_at: string;
          description: string | null;
          group_id: string | null;
          id: string;
          logo_url: string | null;
          name: string;
          opening_balance: number;
          payouts_to_balance: boolean;
          pipeline_position: number;
          pipeline_stage: string;
          position: number;
          shopify_store_id: string | null;
          status: string;
          tag: string | null;
          updated_at: string;
          user_id: string;
          weekend_payouts_to_monday: boolean;
        };
        Insert: {
          archived?: boolean;
          country?: string | null;
          created_at?: string;
          description?: string | null;
          group_id?: string | null;
          id?: string;
          logo_url?: string | null;
          name: string;
          opening_balance?: number;
          payouts_to_balance?: boolean;
          pipeline_position?: number;
          pipeline_stage?: string;
          position?: number;
          shopify_store_id?: string | null;
          status?: string;
          tag?: string | null;
          updated_at?: string;
          user_id: string;
          weekend_payouts_to_monday?: boolean;
        };
        Update: {
          archived?: boolean;
          country?: string | null;
          created_at?: string;
          description?: string | null;
          group_id?: string | null;
          id?: string;
          logo_url?: string | null;
          name?: string;
          opening_balance?: number;
          payouts_to_balance?: boolean;
          pipeline_position?: number;
          pipeline_stage?: string;
          position?: number;
          shopify_store_id?: string | null;
          status?: string;
          tag?: string | null;
          updated_at?: string;
          user_id?: string;
          weekend_payouts_to_monday?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "shops_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "shop_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      simulated_ad_estimates: {
        Row: {
          avg_ticket: number;
          conversion_rate: number;
          cpa: number;
          created_at: string | null;
          daily_spend: number;
          description: string;
          end_date: string | null;
          id: string;
          payout_lag_days: number;
          start_date: string;
          user_id: string;
        };
        Insert: {
          avg_ticket: number;
          conversion_rate?: number;
          cpa: number;
          created_at?: string | null;
          daily_spend: number;
          description?: string;
          end_date?: string | null;
          id?: string;
          payout_lag_days?: number;
          start_date: string;
          user_id: string;
        };
        Update: {
          avg_ticket?: number;
          conversion_rate?: number;
          cpa?: number;
          created_at?: string | null;
          daily_spend?: number;
          description?: string;
          end_date?: string | null;
          id?: string;
          payout_lag_days?: number;
          start_date?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      simulated_expenses: {
        Row: {
          amount: number;
          created_at: string | null;
          description: string;
          id: string;
          recurrence: string;
          recurrence_until: string | null;
          start_date: string;
          user_id: string;
        };
        Insert: {
          amount: number;
          created_at?: string | null;
          description: string;
          id?: string;
          recurrence?: string;
          recurrence_until?: string | null;
          start_date: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string | null;
          description?: string;
          id?: string;
          recurrence?: string;
          recurrence_until?: string | null;
          start_date?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      sop_edges: {
        Row: {
          created_at: string;
          id: string;
          process_id: string;
          source_id: string;
          target_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          process_id: string;
          source_id: string;
          target_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          process_id?: string;
          source_id?: string;
          target_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sop_edges_process_id_fkey";
            columns: ["process_id"];
            isOneToOne: false;
            referencedRelation: "sop_processes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sop_edges_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sop_steps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sop_edges_target_id_fkey";
            columns: ["target_id"];
            isOneToOne: false;
            referencedRelation: "sop_steps";
            referencedColumns: ["id"];
          },
        ];
      };
      sop_processes: {
        Row: {
          color: string;
          created_at: string;
          description: string | null;
          icon: string | null;
          id: string;
          is_template: boolean;
          layout_type: string;
          name: string;
          position: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          description?: string | null;
          icon?: string | null;
          id?: string;
          is_template?: boolean;
          layout_type?: string;
          name?: string;
          position?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          description?: string | null;
          icon?: string | null;
          id?: string;
          is_template?: boolean;
          layout_type?: string;
          name?: string;
          position?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      sop_step_comments: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          step_id: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          step_id: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          step_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sop_step_comments_step_id_fkey";
            columns: ["step_id"];
            isOneToOne: false;
            referencedRelation: "sop_steps";
            referencedColumns: ["id"];
          },
        ];
      };
      sop_steps: {
        Row: {
          assignee: string | null;
          attachments: Json;
          checklist: Json;
          color: string | null;
          created_at: string;
          description: string | null;
          done_at: string | null;
          id: string;
          links: Json;
          manual: boolean;
          media: Json;
          notes: string | null;
          parent_id: string | null;
          position: number;
          process_id: string;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
          x: number;
          y: number;
        };
        Insert: {
          assignee?: string | null;
          attachments?: Json;
          checklist?: Json;
          color?: string | null;
          created_at?: string;
          description?: string | null;
          done_at?: string | null;
          id?: string;
          links?: Json;
          manual?: boolean;
          media?: Json;
          notes?: string | null;
          parent_id?: string | null;
          position?: number;
          process_id: string;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id: string;
          x?: number;
          y?: number;
        };
        Update: {
          assignee?: string | null;
          attachments?: Json;
          checklist?: Json;
          color?: string | null;
          created_at?: string;
          description?: string | null;
          done_at?: string | null;
          id?: string;
          links?: Json;
          manual?: boolean;
          media?: Json;
          notes?: string | null;
          parent_id?: string | null;
          position?: number;
          process_id?: string;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
          x?: number;
          y?: number;
        };
        Relationships: [
          {
            foreignKeyName: "sop_steps_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "sop_steps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sop_steps_process_id_fkey";
            columns: ["process_id"];
            isOneToOne: false;
            referencedRelation: "sop_processes";
            referencedColumns: ["id"];
          },
        ];
      };
      store_board_columns: {
        Row: {
          color: string | null;
          created_at: string | null;
          excluded_from_caixa: boolean;
          features: string[];
          id: string;
          name: string;
          position: number;
          sync_paused: boolean;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string | null;
          excluded_from_caixa?: boolean;
          features?: string[];
          id?: string;
          name: string;
          position?: number;
          sync_paused?: boolean;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          color?: string | null;
          created_at?: string | null;
          excluded_from_caixa?: boolean;
          features?: string[];
          id?: string;
          name?: string;
          position?: number;
          sync_paused?: boolean;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      store_credentials: {
        Row: {
          created_at: string;
          id: string;
          label: string;
          position: number;
          shopify_store_id: string;
          updated_at: string;
          user_id: string;
          value: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          label: string;
          position?: number;
          shopify_store_id: string;
          updated_at?: string;
          user_id: string;
          value?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          label?: string;
          position?: number;
          shopify_store_id?: string;
          updated_at?: string;
          user_id?: string;
          value?: string;
        };
        Relationships: [
          {
            foreignKeyName: "store_credentials_shopify_store_id_fkey";
            columns: ["shopify_store_id"];
            isOneToOne: false;
            referencedRelation: "shopify_stores";
            referencedColumns: ["id"];
          },
        ];
      };
      store_production: {
        Row: {
          shopify_store_id: string;
          updated_at: string;
          user_id: string;
          values: Json;
        };
        Insert: {
          shopify_store_id: string;
          updated_at?: string;
          user_id: string;
          values?: Json;
        };
        Update: {
          shopify_store_id?: string;
          updated_at?: string;
          user_id?: string;
          values?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "store_production_shopify_store_id_fkey";
            columns: ["shopify_store_id"];
            isOneToOne: true;
            referencedRelation: "shopify_stores";
            referencedColumns: ["id"];
          },
        ];
      };
      store_production_files: {
        Row: {
          created_at: string;
          id: string;
          mime: string | null;
          name: string;
          path: string;
          shopify_store_id: string;
          size: number;
          uploaded_by: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          mime?: string | null;
          name: string;
          path: string;
          shopify_store_id: string;
          size?: number;
          uploaded_by?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          mime?: string | null;
          name?: string;
          path?: string;
          shopify_store_id?: string;
          size?: number;
          uploaded_by?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "store_production_files_shopify_store_id_fkey";
            columns: ["shopify_store_id"];
            isOneToOne: false;
            referencedRelation: "shopify_stores";
            referencedColumns: ["id"];
          },
        ];
      };
      store_production_policies: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          position: number;
          shopify_store_id: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content?: string;
          created_at?: string;
          id?: string;
          position?: number;
          shopify_store_id: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          position?: number;
          shopify_store_id?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "store_production_policies_shopify_store_id_fkey";
            columns: ["shopify_store_id"];
            isOneToOne: false;
            referencedRelation: "shopify_stores";
            referencedColumns: ["id"];
          },
        ];
      };
      store_production_preset_files: {
        Row: {
          created_at: string;
          id: string;
          mime: string | null;
          name: string;
          path: string;
          preset_id: string;
          size: number;
          uploaded_by: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          mime?: string | null;
          name: string;
          path: string;
          preset_id: string;
          size?: number;
          uploaded_by?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          mime?: string | null;
          name?: string;
          path?: string;
          preset_id?: string;
          size?: number;
          uploaded_by?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "store_production_preset_files_preset_id_fkey";
            columns: ["preset_id"];
            isOneToOne: false;
            referencedRelation: "store_production_presets";
            referencedColumns: ["id"];
          },
        ];
      };
      store_production_presets: {
        Row: {
          created_at: string;
          credentials: Json;
          id: string;
          is_default: boolean;
          name: string;
          policies: Json;
          position: number;
          scope: string;
          tasks: Json;
          updated_at: string;
          user_id: string;
          values: Json;
        };
        Insert: {
          created_at?: string;
          credentials?: Json;
          id?: string;
          is_default?: boolean;
          name: string;
          policies?: Json;
          position?: number;
          scope?: string;
          tasks?: Json;
          updated_at?: string;
          user_id: string;
          values?: Json;
        };
        Update: {
          created_at?: string;
          credentials?: Json;
          id?: string;
          is_default?: boolean;
          name?: string;
          policies?: Json;
          position?: number;
          scope?: string;
          tasks?: Json;
          updated_at?: string;
          user_id?: string;
          values?: Json;
        };
        Relationships: [];
      };
      store_production_tasks: {
        Row: {
          assignee_id: string | null;
          checklist: Json;
          created_at: string;
          description: string | null;
          done: boolean;
          due_date: string | null;
          id: string;
          position: number;
          shopify_store_id: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          assignee_id?: string | null;
          checklist?: Json;
          created_at?: string;
          description?: string | null;
          done?: boolean;
          due_date?: string | null;
          id?: string;
          position?: number;
          shopify_store_id: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          assignee_id?: string | null;
          checklist?: Json;
          created_at?: string;
          description?: string | null;
          done?: boolean;
          due_date?: string | null;
          id?: string;
          position?: number;
          shopify_store_id?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "store_production_tasks_shopify_store_id_fkey";
            columns: ["shopify_store_id"];
            isOneToOne: false;
            referencedRelation: "shopify_stores";
            referencedColumns: ["id"];
          },
        ];
      };
      store_production_templates: {
        Row: {
          fields: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          fields?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          fields?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      store_revenues: {
        Row: {
          amount: number;
          created_at: string;
          date: string;
          id: string;
          store_id: string;
          user_id: string;
        };
        Insert: {
          amount?: number;
          created_at?: string;
          date: string;
          id?: string;
          store_id: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          date?: string;
          id?: string;
          store_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "store_revenues_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      stores: {
        Row: {
          color: string;
          created_at: string;
          id: string;
          name: string;
          position: number;
          user_id: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          id?: string;
          name: string;
          position?: number;
          user_id: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          id?: string;
          name?: string;
          position?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      support_conversations: {
        Row: {
          ai_tags: string[];
          created_at: string;
          customer_email: string;
          customer_name: string | null;
          favorite: boolean;
          id: string;
          last_inbound_at: string | null;
          last_message_at: string | null;
          last_outbound_at: string | null;
          message_count: number;
          note: string | null;
          owner_id: string;
          resolved_at: string | null;
          shop_id: string | null;
          shop_manual: boolean;
          status: string;
          subject: string | null;
          summary: string | null;
          tags: string[];
          unread_count: number;
          updated_at: string;
        };
        Insert: {
          ai_tags?: string[];
          created_at?: string;
          customer_email: string;
          customer_name?: string | null;
          favorite?: boolean;
          id?: string;
          last_inbound_at?: string | null;
          last_message_at?: string | null;
          last_outbound_at?: string | null;
          message_count?: number;
          note?: string | null;
          owner_id: string;
          resolved_at?: string | null;
          shop_id?: string | null;
          shop_manual?: boolean;
          status?: string;
          subject?: string | null;
          summary?: string | null;
          tags?: string[];
          unread_count?: number;
          updated_at?: string;
        };
        Update: {
          ai_tags?: string[];
          created_at?: string;
          customer_email?: string;
          customer_name?: string | null;
          favorite?: boolean;
          id?: string;
          last_inbound_at?: string | null;
          last_message_at?: string | null;
          last_outbound_at?: string | null;
          message_count?: number;
          note?: string | null;
          owner_id?: string;
          resolved_at?: string | null;
          shop_id?: string | null;
          shop_manual?: boolean;
          status?: string;
          subject?: string | null;
          summary?: string | null;
          tags?: string[];
          unread_count?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_conversations_shop_id_fkey";
            columns: ["shop_id"];
            isOneToOne: false;
            referencedRelation: "shops";
            referencedColumns: ["id"];
          },
        ];
      };
      support_manual_checks: {
        Row: {
          created_at: string;
          erro: string | null;
          evaluated_at: string | null;
          id: string;
          licoes: string[];
          message_id: string;
          o_que_mudou: string | null;
          owner_id: string;
          rascunho: string | null;
          reply_id: string | null;
          semelhanca: string | null;
          status: string;
          tags: string[];
          week: string;
        };
        Insert: {
          created_at?: string;
          erro?: string | null;
          evaluated_at?: string | null;
          id?: string;
          licoes?: string[];
          message_id: string;
          o_que_mudou?: string | null;
          owner_id: string;
          rascunho?: string | null;
          reply_id?: string | null;
          semelhanca?: string | null;
          status?: string;
          tags?: string[];
          week: string;
        };
        Update: {
          created_at?: string;
          erro?: string | null;
          evaluated_at?: string | null;
          id?: string;
          licoes?: string[];
          message_id?: string;
          o_que_mudou?: string | null;
          owner_id?: string;
          rascunho?: string | null;
          reply_id?: string | null;
          semelhanca?: string | null;
          status?: string;
          tags?: string[];
          week?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_manual_checks_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "support_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      support_messages: {
        Row: {
          ai_checked: boolean;
          ai_draft: string | null;
          ai_draft_at: string | null;
          ai_draft_eval: Json | null;
          ai_draft_pt: string | null;
          auto_reply: string | null;
          auto_reply_at: string | null;
          auto_reply_text: string | null;
          content_html: string | null;
          content_pt: string | null;
          conversation_id: string;
          created_at: string;
          direction: string;
          folder_id: string;
          from_email: string | null;
          from_name: string | null;
          has_attachment: boolean;
          id: string;
          is_read: boolean;
          message_id: string;
          owner_id: string;
          sent_at: string;
          subject: string | null;
          summary: string | null;
          thread_id: string | null;
          to_emails: string | null;
        };
        Insert: {
          ai_checked?: boolean;
          ai_draft?: string | null;
          ai_draft_at?: string | null;
          ai_draft_eval?: Json | null;
          ai_draft_pt?: string | null;
          auto_reply?: string | null;
          auto_reply_at?: string | null;
          auto_reply_text?: string | null;
          content_html?: string | null;
          content_pt?: string | null;
          conversation_id: string;
          created_at?: string;
          direction: string;
          folder_id: string;
          from_email?: string | null;
          from_name?: string | null;
          has_attachment?: boolean;
          id?: string;
          is_read?: boolean;
          message_id: string;
          owner_id: string;
          sent_at: string;
          subject?: string | null;
          summary?: string | null;
          thread_id?: string | null;
          to_emails?: string | null;
        };
        Update: {
          ai_checked?: boolean;
          ai_draft?: string | null;
          ai_draft_at?: string | null;
          ai_draft_eval?: Json | null;
          ai_draft_pt?: string | null;
          auto_reply?: string | null;
          auto_reply_at?: string | null;
          auto_reply_text?: string | null;
          content_html?: string | null;
          content_pt?: string | null;
          conversation_id?: string;
          created_at?: string;
          direction?: string;
          folder_id?: string;
          from_email?: string | null;
          from_name?: string | null;
          has_attachment?: boolean;
          id?: string;
          is_read?: boolean;
          message_id?: string;
          owner_id?: string;
          sent_at?: string;
          subject?: string | null;
          summary?: string | null;
          thread_id?: string | null;
          to_emails?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "support_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "support_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      support_playbook: {
        Row: {
          based_on: number;
          owner_id: string;
          rules: Json;
          updated_at: string;
        };
        Insert: {
          based_on?: number;
          owner_id: string;
          rules?: Json;
          updated_at?: string;
        };
        Update: {
          based_on?: number;
          owner_id?: string;
          rules?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      support_settings: {
        Row: {
          ai_tags_enabled: boolean;
          auto_reply_tracking: boolean;
          bh_days: number[];
          bh_end: number;
          bh_start: number;
          bh_timezone: string;
          goal_first_response_min: number;
          goal_resolution_min: number;
          owner_id: string;
          signature: string | null;
          signature_enabled: boolean;
          tags: string[];
          updated_at: string;
        };
        Insert: {
          ai_tags_enabled?: boolean;
          auto_reply_tracking?: boolean;
          bh_days?: number[];
          bh_end?: number;
          bh_start?: number;
          bh_timezone?: string;
          goal_first_response_min?: number;
          goal_resolution_min?: number;
          owner_id: string;
          signature?: string | null;
          signature_enabled?: boolean;
          tags?: string[];
          updated_at?: string;
        };
        Update: {
          ai_tags_enabled?: boolean;
          auto_reply_tracking?: boolean;
          bh_days?: number[];
          bh_end?: number;
          bh_start?: number;
          bh_timezone?: string;
          goal_first_response_min?: number;
          goal_resolution_min?: number;
          owner_id?: string;
          signature?: string | null;
          signature_enabled?: boolean;
          tags?: string[];
          updated_at?: string;
        };
        Relationships: [];
      };
      support_templates: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          owner_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          owner_id: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          owner_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      task_completion_logs: {
        Row: {
          completed_at: string;
          completed_on: string;
          id: string;
          task_id: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string;
          completed_on?: string;
          id?: string;
          task_id: string;
          user_id: string;
        };
        Update: {
          completed_at?: string;
          completed_on?: string;
          id?: string;
          task_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          area: string;
          assignee_id: string | null;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          due_date: string | null;
          id: string;
          priority: string;
          source_key: string | null;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          area?: string;
          assignee_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          priority?: string;
          source_key?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          area?: string;
          assignee_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          priority?: string;
          source_key?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      track123_event_rules: {
        Row: {
          created_at: string;
          enabled: boolean;
          event_key: string;
          event_label: string;
          id: string;
          position: number;
          shop_id: string;
          target_status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          event_key: string;
          event_label: string;
          id?: string;
          position?: number;
          shop_id: string;
          target_status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          event_key?: string;
          event_label?: string;
          id?: string;
          position?: number;
          shop_id?: string;
          target_status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      track123_integrations: {
        Row: {
          api_key: string | null;
          created_at: string;
          enabled: boolean;
          id: string;
          last_sync_at: string | null;
          last_sync_error: string | null;
          last_sync_status: string | null;
          mcp_store_uuid: string | null;
          provider: string;
          shop_id: string;
          token: string | null;
          tracking_link_template: string;
          updated_at: string;
          user_id: string;
          webhook_secret: string;
        };
        Insert: {
          api_key?: string | null;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string | null;
          mcp_store_uuid?: string | null;
          provider?: string;
          shop_id: string;
          token?: string | null;
          tracking_link_template?: string;
          updated_at?: string;
          user_id: string;
          webhook_secret?: string;
        };
        Update: {
          api_key?: string | null;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          last_sync_status?: string | null;
          mcp_store_uuid?: string | null;
          provider?: string;
          shop_id?: string;
          token?: string | null;
          tracking_link_template?: string;
          updated_at?: string;
          user_id?: string;
          webhook_secret?: string;
        };
        Relationships: [];
      };
      tracking_text_overrides: {
        Row: {
          display_text: string;
          example_text: string;
          id: string;
          text_key: string;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          display_text: string;
          example_text?: string;
          id?: string;
          text_key: string;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          display_text?: string;
          example_text?: string;
          id?: string;
          text_key?: string;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      training_lessons: {
        Row: {
          content: Json;
          created_at: string;
          duration_min: number | null;
          id: string;
          kind: string;
          position: number;
          title: string;
          track_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content?: Json;
          created_at?: string;
          duration_min?: number | null;
          id?: string;
          kind: string;
          position?: number;
          title: string;
          track_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content?: Json;
          created_at?: string;
          duration_min?: number | null;
          id?: string;
          kind?: string;
          position?: number;
          title?: string;
          track_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "training_lessons_track_id_fkey";
            columns: ["track_id"];
            isOneToOne: false;
            referencedRelation: "training_tracks";
            referencedColumns: ["id"];
          },
        ];
      };
      training_progress: {
        Row: {
          completed_at: string;
          lesson_id: string;
          member_id: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string;
          lesson_id: string;
          member_id: string;
          user_id: string;
        };
        Update: {
          completed_at?: string;
          lesson_id?: string;
          member_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "training_progress_lesson_id_fkey";
            columns: ["lesson_id"];
            isOneToOne: false;
            referencedRelation: "training_lessons";
            referencedColumns: ["id"];
          },
        ];
      };
      training_tracks: {
        Row: {
          color: string;
          created_at: string;
          description: string | null;
          emoji: string | null;
          id: string;
          position: number;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          description?: string | null;
          emoji?: string | null;
          id?: string;
          position?: number;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          description?: string | null;
          emoji?: string | null;
          id?: string;
          position?: number;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      workspace_lists: {
        Row: {
          color: string;
          created_at: string;
          id: string;
          name: string;
          position: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          id?: string;
          name: string;
          position?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          id?: string;
          name?: string;
          position?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          created_at: string;
          home_path: string | null;
          id: string;
          is_admin: boolean;
          member_id: string;
          owner_id: string;
        };
        Insert: {
          created_at?: string;
          home_path?: string | null;
          id?: string;
          is_admin?: boolean;
          member_id: string;
          owner_id: string;
        };
        Update: {
          created_at?: string;
          home_path?: string | null;
          id?: string;
          is_admin?: boolean;
          member_id?: string;
          owner_id?: string;
        };
        Relationships: [];
      };
      workspace_statuses: {
        Row: {
          color: string;
          created_at: string;
          id: string;
          is_done: boolean;
          list_id: string;
          name: string;
          position: number;
          user_id: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          id?: string;
          is_done?: boolean;
          list_id: string;
          name: string;
          position?: number;
          user_id: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          id?: string;
          is_done?: boolean;
          list_id?: string;
          name?: string;
          position?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_statuses_list_id_fkey";
            columns: ["list_id"];
            isOneToOne: false;
            referencedRelation: "workspace_lists";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_tasks: {
        Row: {
          assignee_id: string | null;
          checklist: Json;
          created_at: string;
          description: string | null;
          due_at: string | null;
          id: string;
          list_id: string;
          position: number;
          priority: string;
          status_id: string;
          tags: Json;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          assignee_id?: string | null;
          checklist?: Json;
          created_at?: string;
          description?: string | null;
          due_at?: string | null;
          id?: string;
          list_id: string;
          position?: number;
          priority?: string;
          status_id: string;
          tags?: Json;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          assignee_id?: string | null;
          checklist?: Json;
          created_at?: string;
          description?: string | null;
          due_at?: string | null;
          id?: string;
          list_id?: string;
          position?: number;
          priority?: string;
          status_id?: string;
          tags?: Json;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_tasks_list_id_fkey";
            columns: ["list_id"];
            isOneToOne: false;
            referencedRelation: "workspace_lists";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_tasks_status_id_fkey";
            columns: ["status_id"];
            isOneToOne: false;
            referencedRelation: "workspace_statuses";
            referencedColumns: ["id"];
          },
        ];
      };
      zoho_mail_accounts: {
        Row: {
          access_token: string | null;
          access_token_expires_at: string | null;
          account_id: string | null;
          accounts_server: string;
          addresses: string[];
          client_id: string;
          client_secret: string;
          connected_at: string | null;
          created_at: string;
          display_name: string | null;
          email: string | null;
          inbox_folder_id: string | null;
          last_sync_at: string | null;
          last_sync_error: string | null;
          mail_api_base: string;
          owner_id: string;
          refresh_token: string | null;
          send_as: string | null;
          send_as_options: string[];
          sent_folder_id: string | null;
          updated_at: string;
        };
        Insert: {
          access_token?: string | null;
          access_token_expires_at?: string | null;
          account_id?: string | null;
          accounts_server?: string;
          addresses?: string[];
          client_id: string;
          client_secret: string;
          connected_at?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          inbox_folder_id?: string | null;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          mail_api_base?: string;
          owner_id: string;
          refresh_token?: string | null;
          send_as?: string | null;
          send_as_options?: string[];
          sent_folder_id?: string | null;
          updated_at?: string;
        };
        Update: {
          access_token?: string | null;
          access_token_expires_at?: string | null;
          account_id?: string | null;
          accounts_server?: string;
          addresses?: string[];
          client_id?: string;
          client_secret?: string;
          connected_at?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          inbox_folder_id?: string | null;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          mail_api_base?: string;
          owner_id?: string;
          refresh_token?: string | null;
          send_as?: string | null;
          send_as_options?: string[];
          sent_folder_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      zoho_oauth_states: {
        Row: {
          client_id: string;
          client_secret: string;
          created_at: string;
          expires_at: string;
          owner_id: string;
          redirect_uri: string;
          state: string;
        };
        Insert: {
          client_id: string;
          client_secret: string;
          created_at?: string;
          expires_at: string;
          owner_id: string;
          redirect_uri: string;
          state: string;
        };
        Update: {
          client_id?: string;
          client_secret?: string;
          created_at?: string;
          expires_at?: string;
          owner_id?: string;
          redirect_uri?: string;
          state?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      loose_line_item_titles: {
        Args: { p_shop_ids: string[]; p_user_id: string };
        Returns: { line_item_title: string; orders: number; title: string }[];
      };
      normalize_line_item_title: { Args: { t: string }; Returns: string };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      has_workspace_access: {
        Args: {
          _member: string;
          _owner: string;
          _resource?: string;
          _section: string;
        };
        Returns: boolean;
      };
      public_rate_limit_hit: {
        Args: {
          p_bucket: string;
          p_ip: string;
          p_max: number;
          p_window_min: number;
        };
        Returns: boolean;
      };
      replace_member_permissions: {
        Args: { p_member: string; p_perms: Json };
        Returns: undefined;
      };
      replace_pending_payouts: {
        Args: { p_rows: Json; p_shop_id: string; p_user_id: string };
        Returns: undefined;
      };
      shop_by_customer_emails: {
        Args: { p_emails: string[]; p_user_id: string };
        Returns: {
          email: string;
          shop_id: string;
        }[];
      };
      shop_order_ids_by_email: {
        Args: { p_email: string; p_user_id: string };
        Returns: string[];
      };
    };
    Enums: {
      app_role: "admin" | "member";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "member"],
    },
  },
} as const;
