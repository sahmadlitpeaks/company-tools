import { Link, useLocation } from "react-router-dom";

export default function NotFoundPage() {
  const location = useLocation();
  return (
    <div className="grid place-items-center py-20 text-center">
      <div>
        <div className="text-6xl font-bold text-brand-600">404</div>
        <h2 className="mt-2">Page not found</h2>
        <p className="muted">
          We couldn't find{" "}
          <code className="break-all">{location.pathname}</code>.
        </p>
        <Link className="btn-primary mt-4 inline-block" to="/">
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}
