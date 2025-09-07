import React, { Suspense } from "react";

const CreateClient = React.lazy(() => import("./CreateClient"));

export default function CreatePage() {
  return (
    <Suspense fallback={<div className="max-w-3xl mx-auto">Loading…</div>}>
      {/* CreateClient is a client component and uses next/navigation hooks */}
      <CreateClient />
    </Suspense>
  );
}
