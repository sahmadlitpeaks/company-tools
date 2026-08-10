import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { api } from "../api/client";

interface FetchState<T> {
  path: string | null;
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useFetch<T>(path: string | null) {
  const [state, setState] = useState<FetchState<T>>({
    path,
    data: null,
    loading: path !== null,
    error: null,
  });
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    controllerRef.current?.abort();

    if (path === null) {
      controllerRef.current = null;
      setState({ path, data: null, loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setState((current) => ({
      path,
      data: current.path === path ? current.data : null,
      loading: true,
      error: null,
    }));

    try {
      const data = await api<T>(path, { signal: controller.signal });
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      setState({ path, data, loading: false, error: null });
    } catch (e) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      setState((current) => ({
        path,
        data: current.path === path ? current.data : null,
        loading: false,
        error: e instanceof Error ? e.message : "Request failed",
      }));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [path]);

  useEffect(() => {
    void reload();
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [reload]);

  const setData = useCallback((value: SetStateAction<T | null>) => {
    setState((current) => {
      const currentData = current.path === path ? current.data : null;
      const data = typeof value === "function"
        ? (value as (previous: T | null) => T | null)(currentData)
        : value;
      return {
        path,
        data,
        loading: path !== null && (current.path !== path || current.loading),
        error: current.path === path ? current.error : null,
      };
    });
  }, [path]);

  const isCurrentPath = state.path === path;
  return {
    data: isCurrentPath ? state.data : null,
    loading: path !== null && (!isCurrentPath || state.loading),
    error: isCurrentPath ? state.error : null,
    reload,
    setData,
  };
}
