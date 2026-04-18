import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          name: string;
          email: string;
          role: "admin" | "operator";
          active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          name: string;
          email: string;
          role?: "admin" | "operator";
          active?: boolean;
        };
        Update: Partial<{
          name: string;
          email: string;
          role: "admin" | "operator";
          active: boolean;
        }>;
      };
      clients: {
        Row: {
          id: string;
          name: string;
          whatsapp: string;
          email: string | null;
          nationality: string | null;
          language_preference: string | null;
          vip_tier: string;
          notes: string | null;
          inactive: boolean;
          created_at: string;
          created_by: string | null;
        };
      };
      bookings: {
        Row: {
          id: string;
          tvl_ref: string;
          client_id: string | null;
          service_type: string;
          status: string;
          price: number;
          date_time: string | null;
          driver_id: string | null;
          operator_id: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      messages: {
        Row: {
          id: string;
          channel: string | null;
          sender_id: string | null;
          recipient_id: string | null;
          content: string;
          read: boolean;
          created_at: string;
        };
      };
      flight_status_cache: {
        Row: {
          id: string;
          flight_number: string;
          date: string;
          status: string | null;
          scheduled_time: string | null;
          estimated_time: string | null;
          delay_minutes: number;
          terminal: string | null;
          last_updated: string;
        };
      };
    };
  };
};
