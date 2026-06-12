import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api/client";
import type { Brand } from "../api/types";

const ACTIVE_KEY = "ag_active_brand";

interface BrandState {
  brands: Brand[];
  active: Brand | null;
  loading: boolean;
  setActive: (id: string) => void;
  reload: () => Promise<void>;
}

const BrandCtx = createContext<BrandState | undefined>(undefined);

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeId, setActiveId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_KEY),
  );
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await api<Brand[]>("/api/companies");
      setBrands(data);
    } catch {
      setBrands([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setActive = useCallback((id: string) => {
    setActiveId(id);
    localStorage.setItem(ACTIVE_KEY, id);
  }, []);

  // Resolve the active brand; fall back to the default (or first) brand.
  const active = useMemo(() => {
    if (brands.length === 0) return null;
    return (
      brands.find((b) => b.id === activeId) ??
      brands.find((b) => b.is_default) ??
      brands[0]
    );
  }, [brands, activeId]);

  const value = useMemo(
    () => ({ brands, active, loading, setActive, reload }),
    [brands, active, loading, setActive, reload],
  );

  return <BrandCtx.Provider value={value}>{children}</BrandCtx.Provider>;
}

export function useBrand(): BrandState {
  const ctx = useContext(BrandCtx);
  if (!ctx) throw new Error("useBrand must be used within BrandProvider");
  return ctx;
}
