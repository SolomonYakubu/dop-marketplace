/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { PinataSDK } from "pinata";

// Only initialize Pinata SDK if we have valid credentials
let pinata: PinataSDK | null = null;
const isDevelopmentMode =
  !process.env.NEXT_PUBLIC_PINATA_JWT ||
  process.env.NEXT_PUBLIC_PINATA_JWT === "your_pinata_jwt_here";

if (!isDevelopmentMode) {
  try {
    pinata = new PinataSDK({
      pinataJwt: process.env.NEXT_PUBLIC_PINATA_JWT,
      pinataGateway: process.env.NEXT_PUBLIC_PINATA_GATEWAY,
    });
  } catch (error) {
    console.warn("Failed to initialize Pinata SDK in API route:", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // For development, return a mock response
    if (isDevelopmentMode || !pinata) {
      const cid = `mock-hash-${Date.now()}`;
      return NextResponse.json({
        // Keep both for compatibility
        cid,
        IpfsHash: cid,
        PinSize: file.size,
        Timestamp: new Date().toISOString(),
      });
    }

    // Use correct Pinata SDK v2 API - public upload so content is gateway-accessible
    const upload = await pinata.upload.public!.file(file);

    return NextResponse.json({
      // Keep both for compatibility
      cid: upload.cid,
      IpfsHash: upload.cid,
      PinSize: (upload as any).size,
      Timestamp: (upload as any).created_at,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
