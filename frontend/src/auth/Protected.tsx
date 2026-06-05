import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";

/** Route guard: renders children only if the user has `module` (or is admin). */
export default function Protected({
  module,
  adminOnly,
  children,
}: {
  module?: string;
  adminOnly?: boolean;
  children: ReactNode;
}) {
  const { user, can } = useAuth();
  const ok =
    !!user && (user.is_admin || ((!adminOnly || false) && (!module || can(module))));

  if (!ok)
    return (
      <div className="center-screen" style={{ minHeight: "60vh" }}>
        <div className="login-card text-center">
          <ShieldAlert className="mx-auto mb-3 text-ink-muted" size={36} />
          <h2 className="mb-1">No access</h2>
          <p className="muted">
            You don't have permission to view this area. Ask an administrator if
            you need it.
          </p>
        </div>
      </div>
    );

  return <>{children}</>;
}
