"use client";

import {
  supabase,
  type OfferChatMessage as DirectMessage, // reuse same shape
} from "@/lib/supabaseClient";
import type { ChatDataProvider, ChatMessage, SendMessageInput } from "../types";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

function normalizePair(a: string, b: string): [string, string] {
  const A = a.toLowerCase();
  const B = b.toLowerCase();
  return A <= B ? [A, B] : [B, A];
}

export class DirectChatProvider implements ChatDataProvider {
  private readonly lo: string;
  private readonly hi: string;
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastUpdatedAt: string | null = null;

  constructor(userA: string, userB: string) {
    const [lo, hi] = normalizePair(userA, userB);
    this.lo = lo;
    this.hi = hi;
  }

  async load(): Promise<ChatMessage[]> {
    const { data } = await supabase
      .from("direct_chats")
      .select("user_lo,user_hi,messages,updated_at")
      .eq("user_lo", this.lo)
      .eq("user_hi", this.hi)
      .maybeSingle();
    if (data) {
      this.lastUpdatedAt = (data.updated_at as string) || null;
      const msgs = (data.messages as unknown as DirectMessage[]) || [];
      return msgs as ChatMessage[];
    }
    return [];
  }

  subscribe(onChange: (messages: ChatMessage[]) => void): () => void {
    this.channel = supabase
      .channel(`direct_chat_${this.lo}_${this.hi}`)
      .on(
        "postgres_changes",
        {
          schema: "public",
          table: "direct_chats",
          event: "*",
          filter: `user_lo=eq.${this.lo},user_hi=eq.${this.hi}`,
        },
        (
          payload: RealtimePostgresChangesPayload<{
            messages: DirectMessage[];
            updated_at: string;
          }>
        ) => {
          const newDoc = payload.new as {
            messages: DirectMessage[];
            updated_at: string;
          } | null;
          if (newDoc) {
            this.lastUpdatedAt = newDoc.updated_at || this.lastUpdatedAt;
            onChange(
              Array.isArray(newDoc.messages)
                ? (newDoc.messages as ChatMessage[])
                : []
            );
          } else {
            void this.fetchLatest(onChange);
          }
        }
      )
      .subscribe();

    this.startPolling(onChange);
    return () => {
      if (this.channel) supabase.removeChannel(this.channel);
      this.channel = null;
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = null;
    };
  }

  private async fetchLatest(onChange: (messages: ChatMessage[]) => void) {
    const { data } = await supabase
      .from("direct_chats")
      .select("messages,updated_at")
      .eq("user_lo", this.lo)
      .eq("user_hi", this.hi)
      .maybeSingle();
    if (data) {
      const changed =
        !this.lastUpdatedAt || data.updated_at !== this.lastUpdatedAt;
      this.lastUpdatedAt = (data.updated_at as string) || this.lastUpdatedAt;
      if (changed) {
        const msgs = (data.messages as unknown as DirectMessage[]) || [];
        onChange(msgs as ChatMessage[]);
      }
    }
  }

  private startPolling(onChange: (messages: ChatMessage[]) => void) {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      void this.fetchLatest(onChange);
    }, 2000);
  }

  async send(
    input: SendMessageInput,
    opts?: { sender: string }
  ): Promise<void> {
    const attachmentUris: string[] = [];
    if (input.files?.length) {
      for (const file of input.files) {
        try {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch("/api/ipfs", { method: "POST", body: form });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || "Upload failed");
          attachmentUris.push(`ipfs://${data.cid}`);
        } catch (err) {
          console.warn("Attachment upload failed", err);
        }
      }
    }

    const message: DirectMessage & {
      linkUrl?: string;
      linkTitle?: string;
      linkType?: "gig" | "brief";
    } = {
      id:
        globalThis.crypto && "randomUUID" in globalThis.crypto
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,
      sender: opts?.sender?.toLowerCase() || "",
      content: input.text || undefined,
      attachments: attachmentUris.length ? attachmentUris : undefined,
      created_at: new Date().toISOString(),
      message_type: "text",
    };

    if (input.pin) {
      const idStr = String(input.pin.id);
      const kind = input.pin.type;
      const url =
        input.pin.url ||
        (kind === "gig" ? `/gigs/${idStr}` : `/briefs/${idStr}`);
      message.linkUrl = url;
      message.linkTitle =
        input.pin.title || `${kind === "gig" ? "Gig" : "Brief"} #${idStr}`;
      message.linkType = kind;
      message.message_type = "pin";
    } else if (attachmentUris.length && input.text) {
      message.message_type = "mixed";
    } else if (attachmentUris.length) {
      message.message_type = "image";
    } else {
      message.message_type = "text";
    }

    const { error: rpcError } = await supabase.rpc(
      "append_direct_chat_message",
      {
        p_user_lo: this.lo,
        p_user_hi: this.hi,
        p_message: message as unknown as Record<string, unknown>,
      }
    );
    if (rpcError) {
      // Fallback read-modify-write
      const { data } = await supabase
        .from("direct_chats")
        .select("messages")
        .eq("user_lo", this.lo)
        .eq("user_hi", this.hi)
        .maybeSingle();
      const msgs = (data?.messages as unknown as DirectMessage[]) || [];
      const next = [...msgs, message];
      const { error: upError } = await supabase
        .from("direct_chats")
        .upsert({ user_lo: this.lo, user_hi: this.hi, messages: next });
      if (upError) throw upError;
    }
  }
}
