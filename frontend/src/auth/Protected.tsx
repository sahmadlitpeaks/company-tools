import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <div className="grid min-h-[60vh] place-items-center bg-linear-to-br from-primary/30 to-background p-5">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <ShieldAlert className="mx-auto text-foreground" aria-hidden="true" />
            <CardTitle>No access</CardTitle>
            <CardDescription>
            You don't have permission to view this area. Ask an administrator if
            you need it.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    );

  return <>{children}</>;
}
