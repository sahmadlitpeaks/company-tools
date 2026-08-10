import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";
import type { LandingPage } from "../../api/types";
import { parseBlocks } from "../../landing/blocks";
import { BlockList } from "../../landing/BlockRenderer";
import { LandingSlugContext } from "../../landing/LandingContext";
import DOMPurify from "dompurify";

export default function PublicLandingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [page, setPage] = useState<LandingPage | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api<LandingPage>(`/api/public/landing-pages/${slug}`, { auth: false })
      .then(setPage)
      .catch(() => setError(true));
  }, [slug]);

  if (error)
    return (
      <main className="grid min-h-dvh place-items-center bg-muted p-5">
        <Card className="w-full max-w-md">
          <CardHeader><CardTitle>Page not found</CardTitle></CardHeader>
          <CardContent><p className="text-muted-foreground">This landing page isn't published.</p></CardContent>
        </Card>
      </main>
    );
  if (!page) return null;

  const blocks = parseBlocks(page.blocks);
  if (blocks.length > 0) {
    return (
      <LandingSlugContext.Provider value={page.slug}>
        <div className="min-h-dvh bg-background">
          <BlockList blocks={blocks} />
        </div>
      </LandingSlugContext.Provider>
    );
  }
  // Fallback for pages authored as raw HTML.
  if (page.html) {
    return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(page.html) }} />;
  }
  return (
    <main className="mx-auto max-w-3xl p-10">
      <h1>{page.title}</h1>
      <p className="text-muted-foreground">{page.description}</p>
    </main>
  );
}
