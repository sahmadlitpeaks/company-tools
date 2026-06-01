import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";
import type { LandingPage } from "../../api/types";

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
      <div className="center-screen">
        <div className="login-card">
          <h2>Page not found</h2>
          <p className="muted">This landing page isn't published.</p>
        </div>
      </div>
    );
  if (!page) return null;

  if (page.html) {
    return <div dangerouslySetInnerHTML={{ __html: page.html }} />;
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 40 }}>
      <h1>{page.title}</h1>
      <p className="muted">{page.description}</p>
    </div>
  );
}
