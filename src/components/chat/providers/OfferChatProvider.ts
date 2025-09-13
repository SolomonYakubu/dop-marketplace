"use client";

import {
  supabase,
  type OfferChatDocument,
  type OfferChatMessage,
} from "@/lib/supabaseClient";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { ChatDataProvider, ChatMessage, SendMessageInput } from "../types";

export class OfferChatProvider implements ChatDataProvider {
  private readonly offerId: string;
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastUpdatedAt: string | null = null;

  constructor(offerId: string) {
    this.offerId = offerId;
  }

  async load(): Promise<ChatMessage[]> {
    const { data } = await supabase
      .from("offer_chats")
      .select("offer_id,messages,updated_at")
      .eq("offer_id", this.offerId)
      .maybeSingle();
    if (data) {
      const doc = data as OfferChatDocument;
      this.lastUpdatedAt = doc.updated_at || null;
      return Array.isArray(doc.messages) ? (doc.messages as ChatMessage[]) : [];
    }
    return [];
  }

  subscribe(onChange: (messages: ChatMessage[]) => void): () => void {
    this.channel = supabase
      .channel(`offer_chat_doc_${this.offerId}`)
      .on(
        "postgres_changes",
        {
          schema: "public",
          table: "offer_chats",
          event: "*",
          filter: `offer_id=eq.${this.offerId}`,
        },
        (payload: RealtimePostgresChangesPayload<OfferChatDocument>) => {
          const newDoc = payload.new as OfferChatDocument;
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
      .from("offer_chats")
      .select("offer_id,messages,updated_at")
      .eq("offer_id", this.offerId)
      .maybeSingle();
    if (data) {
      const doc = data as OfferChatDocument;
      const changed =
        !this.lastUpdatedAt || doc.updated_at !== this.lastUpdatedAt;
      this.lastUpdatedAt = doc.updated_at || this.lastUpdatedAt;
      if (changed) {
        onChange(
          Array.isArray(doc.messages) ? (doc.messages as ChatMessage[]) : []
        );
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

    const message: OfferChatMessage & {
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

    // Pin payload
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
      "append_offer_chat_message",
      {
        p_offer_id: this.offerId,
        p_message: message as unknown as Record<string, unknown>,
      }
    );
    if (rpcError) {
      const { data } = await supabase
        .from("offer_chats")
        .select("messages")
        .eq("offer_id", this.offerId)
        .maybeSingle();
      let msgs: OfferChatMessage[] = [];
      if (data && Array.isArray(data.messages))
        msgs = data.messages as OfferChatMessage[];
      msgs = [...msgs, message];
      const { error: upError } = await supabase
        .from("offer_chats")
        .upsert({ offer_id: this.offerId, messages: msgs });
      if (upError) throw upError;
    }
  }
}
