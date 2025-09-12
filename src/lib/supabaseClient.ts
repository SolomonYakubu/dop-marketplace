import { createClient } from "@supabase/supabase-js";

// Safe single instance (browser only). In Next.js App Router, modules are singleton per RSC/Client boundary.
// We only use this in client components.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});

// New single-document chat model
export interface OfferChatMessage {
  id: string; // uuid
  sender: string; // lowercase wallet
  content?: string; // optional when only attachments
  attachments?: string[]; // ipfs:// URIs
  created_at: string; // ISO string
  message_type?: string | null; // text|image|mixed etc
}

export interface OfferChatDocument {
  offer_id: string; // bigint as string
  messages: OfferChatMessage[];
  updated_at: string; // ISO timestamp
}
