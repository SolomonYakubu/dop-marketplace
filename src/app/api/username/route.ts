import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// GET /api/username?name=foobar -> { address?: string }
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("name") || "").trim();
  if (!raw) return NextResponse.json({ address: null });
  const lower = raw.replace(/^@/, "").toLowerCase();
  const { data, error } = await supabase
    .from("usernames")
    .select("address")
    .eq("username_lower", lower)
    .maybeSingle();
  if (error) return NextResponse.json({ address: null }, { status: 200 });
  return NextResponse.json({ address: data?.address || null });
}

// POST { username, address } -> upsert; used to cache known mappings
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { username?: string; address?: string };
    const username = (body.username || "").trim();
    const address = (body.address || "").trim();
    if (!username || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const lower = username.replace(/^@/, "").toLowerCase();
    const { error } = await supabase.from("usernames").upsert(
      {
        username_lower: lower,
        username,
        address: address.toLowerCase(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "username_lower" }
    );
    if (error) return NextResponse.json({ ok: false }, { status: 200 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
