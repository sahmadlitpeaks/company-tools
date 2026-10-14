import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { DocumentPage } from "@/api/sharepoint";

/** Search text belongs in a POST body, never in URL/access logs. Clear stale results. */
export function useDocumentSearch(q: string, cursor: string, sourceId = "all", enabled = true) {
  const key = enabled ? JSON.stringify([q, cursor, sourceId]) : null;
  const [state, setState] = useState<{
    key: string | null;
    loading: boolean;
    error: string | null;
    data: DocumentPage | null;
  }>({ key, loading: enabled, error: null, data: null });
  const controller = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    controller.current?.abort();
    if (!enabled) {
      controller.current = null;
      setState({ key: null, loading: false, error: null, data: null });
      return;
    }
    const request = new AbortController();
    controller.current = request;
    const requestKey = JSON.stringify([q, cursor, sourceId]);

    // Keep existing data if the search query & cursor are unchanged (stale-while-revalidate)
    setState((prev) => ({
      key: requestKey,
      loading: prev.key !== requestKey || !prev.data,
      error: null,
      data: prev.key === requestKey ? prev.data : null,
    }));

    try {
      const data = await api<DocumentPage>("/api/sharepoint/search", {
        method: "POST",
        body: { q, cursor: cursor || null, source_id: sourceId === "all" ? null : sourceId },
        signal: request.signal,
      });
      if (!request.signal.aborted) {
        setState({ key: requestKey, loading: false, error: null, data });
      }
    } catch (error) {
      if (!request.signal.aborted) {
        setState({
          key: requestKey,
          loading: false,
          data: null,
          error: error instanceof Error ? error.message : "Search failed",
        });
      }
    }
  }, [q, cursor, sourceId, enabled]);

  useEffect(() => {
    void reload();
    return () => controller.current?.abort();
  }, [reload]);

  return {
    loading: enabled && (state.key !== key || state.loading),
    error: enabled && state.key === key ? state.error : null,
    data: enabled && state.key === key ? state.data : null,
    reload,
  };
}
