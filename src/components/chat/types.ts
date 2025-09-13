import type { OfferChatMessage } from "@/lib/supabaseClient";

export type ChatMessage = OfferChatMessage & {
  linkUrl?: string;
  linkTitle?: string;
  linkType?: "gig" | "brief";
};

export type SendMessageInput = {
  text?: string;
  files?: File[];
  pin?: {
    type: "gig" | "brief";
    id: string | number | bigint;
    title?: string;
    url?: string; // optional explicit url override
  };
};

export interface ChatDataProvider {
  // Load initial messages
  load(): Promise<ChatMessage[]>;
  // Subscribe to changes; return unsubscribe
  subscribe(onChange: (messages: ChatMessage[]) => void): () => void;
  // Append a message
  send(input: SendMessageInput, opts?: { sender: string }): Promise<void>;
}
