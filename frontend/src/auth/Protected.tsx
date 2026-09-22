import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";

/**
 * Route guard: renders children only if the user may reach this area.
 *
 * `module` gates on a permission module, `feature` on one named part of a
 * module ("hr.payroll"). Both run through `can`, which also subtracts whatever
 * an administrator has switched off org-wide — so unlike `adminOnly`, being an
 * admin does not see through them.
 */
export default function Protected({
  module,
  feature,
  adminOnly,
  children,
}: {
  module?: string;
  feature?: string;
  adminOnly?: boolean;
  children: ReactNode;
}) {
  const { user, can } = useAuth();
  const key = feature ?? module;
  const ok = !!user && (key ? can(key) : !adminOnly || user.is_admin);

  if (!ok)
    return (
      <div className="grid min-h-[60vh] place-items-center bg-linear-to-br from-primary/30 to-background p-5">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <ShieldAlert className="mx-auto text-foreground" aria-hidden="true" />
            <CardTitle>No access</CardTitle>
            <CardDescription>
            You don't have permission to view this area, or it has been turned
            off. Ask an administrator if you need it.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    );

  return <>{children}</>;
}
