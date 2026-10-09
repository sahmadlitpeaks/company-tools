import { useLocation } from "react-router-dom";
import { issueLink } from "@/api/pm";

/** Keep board, filters and tab when opening another issue in this project. */
export function useIssueHref() {
  const location = useLocation();
  return (projectKey: string, issueKey: string) => issueLink(projectKey, issueKey,
    location.pathname === `/projects/${encodeURIComponent(projectKey)}` ? location.search : "");
}
