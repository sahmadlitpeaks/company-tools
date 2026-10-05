import { useAuth } from "@/auth/AuthContext";
import { Link } from "react-router-dom";
import type { BoardTask } from "@/api/tasks";
import { Button } from "@/components/ui/button";
import { microsoftConnectHref } from "@/components/sharepoint/MicrosoftConnectionFeedback";

export function TaskAccessAction({ task }: { task: BoardTask }) {
  const { user } = useAuth();
  if (task.access_state === "microsoft_connection_required") return <Button nativeButton={false} variant="outline"
    render={<a aria-label="Connect Microsoft to use this task" href={microsoftConnectHref("/tasks?" + new URLSearchParams({ task: task.id }).toString())} />}>Connect Microsoft to use this task</Button>;
  if (task.access_state === "checking") return <p className="text-xs text-muted-foreground">Status changes unlock after the file access check.</p>;
  if (task.access_state === "module_required") return <p className="text-xs text-muted-foreground">An administrator must enable your workspace Compliance access before you can change this task.</p>;
  if (task.can_change_status === false && task.access_state !== "ready") return <Button nativeButton={false} variant="outline"
    render={<Link to={user?.is_admin || user?.role === "manager" ? "/sharepoint/compliance" : "/sharepoint/documents"} />}>Resolve document access</Button>;
  return null;
}
