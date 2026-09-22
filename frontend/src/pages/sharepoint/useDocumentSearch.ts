import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { DocumentPage } from "@/api/sharepoint";

/** Search text belongs in a POST body, never in URL/access logs. Clear stale results. */
export function useDocumentSearch(q: string, cursor: string) {
  const key = JSON.stringify([q, cursor]);
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    error: string | null;
    data: DocumentPage | null;
  }>({ key, loading: true, error: null, data: null });
  const controller = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const requestKey = JSON.stringify([q, cursor]);

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
        body: { q, cursor: cursor || null },
        signal: request.signal,
      });
      if (!request.signal.aborted) {
        setState({ key: requestKey, loading: false, error: null, data });
      }
    } catch (error) {
      if (!request.signal.aborted) {
        setState((prev) => ({
          key: requestKey,
          loading: false,
          data: prev.data,
          error: error instanceof Error ? error.message : "Search failed",
        }));
      }
    }
  }, [q, cursor]);

  useEffect(() => {
    void reload();
    return () => controller.current?.abort();
  }, [reload]);

  return {
    loading: state.loading,
    error: state.key === key ? state.error : null,
    data: state.key === key ? state.data : null,
    reload,
  };
}
