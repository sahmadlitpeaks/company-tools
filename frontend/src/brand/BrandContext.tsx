import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api/client";
import type { Brand } from "../api/types";

const ACTIVE_KEY = "ag_active_brand:v1";
const AG_YELLOW = "#facc15";
const AGIOMIX_GREEN = "oklch(84.5% 0.13 165)";
const TIMEPIECE_BLUE = "oklch(78% 0.14 245)";
const GRILL_TIME_RED = "oklch(71.9% 0.169 13)";

type Rgb = readonly [number, number, number];
type ChartPalette = readonly [string, string, string, string, string];

export interface BrandTheme {
  accent: string;
  foreground: string;
  lightRing: string;
  darkRing: string;
  charts: ChartPalette;
}

const DARK_FOREGROUND = "#18181b";
const LIGHT_FOREGROUND = "#fafafa";

const BRAND_THEMES = {
  ag: {
    accent: AG_YELLOW,
    foreground: DARK_FOREGROUND,
    lightRing: "oklch(23% 0.06 90)",
    darkRing: AG_YELLOW,
    charts: [
      AG_YELLOW,
      "oklch(70.5% 0.213 47.604)",
      "oklch(76.9% 0.188 70.08)",
      "oklch(76.8% 0.233 130.85)",
      "oklch(76.5% 0.177 163.223)",
    ],
  },
  agiomix: {
    accent: AGIOMIX_GREEN,
    foreground: DARK_FOREGROUND,
    lightRing: "oklch(23% 0.06 165)",
    darkRing: AGIOMIX_GREEN,
    charts: [
      AGIOMIX_GREEN,
      "oklch(78.9% 0.154 211.53)",
      "oklch(74.6% 0.16 232.661)",
      "oklch(76.8% 0.233 130.85)",
      "oklch(70.4% 0.14 182.503)",
    ],
  },
  timepiece: {
    accent: TIMEPIECE_BLUE,
    foreground: DARK_FOREGROUND,
    lightRing: "oklch(23% 0.08 245)",
    darkRing: TIMEPIECE_BLUE,
    charts: [
      TIMEPIECE_BLUE,
      "oklch(70.2% 0.183 293.541)",
      "oklch(71.8% 0.202 349.761)",
      "oklch(64.5% 0.246 16.439)",
      "oklch(67.3% 0.182 276.935)",
    ],
  },
  grillTime: {
    accent: GRILL_TIME_RED,
    foreground: DARK_FOREGROUND,
    lightRing: "oklch(23% 0.07 13)",
    darkRing: GRILL_TIME_RED,
    charts: [
      GRILL_TIME_RED,
      AG_YELLOW,
      "oklch(76.9% 0.188 70.08)",
      "oklch(63.7% 0.237 25.331)",
      "oklch(71.8% 0.202 349.761)",
    ],
  },
  cyan: {
    accent: "oklch(78.9% 0.154 211.53)",
    foreground: DARK_FOREGROUND,
    lightRing: "oklch(23% 0.06 211.53)",
    darkRing: "oklch(78.9% 0.154 211.53)",
    charts: [
      "oklch(78.9% 0.154 211.53)",
      "oklch(74.6% 0.16 232.661)",
      "oklch(70.7% 0.165 254.624)",
      "oklch(70.4% 0.14 182.503)",
      "oklch(70.2% 0.183 293.541)",
    ],
  },
  violet: {
    accent: "oklch(70.2% 0.183 293.541)",
    foreground: DARK_FOREGROUND,
    lightRing: "oklch(23% 0.07 293.541)",
    darkRing: "oklch(85% 0.12 293.541)",
    charts: [
      "oklch(70.2% 0.183 293.541)",
      "oklch(66.7% 0.295 322.15)",
      "oklch(67.3% 0.182 276.935)",
      "oklch(74.6% 0.16 232.661)",
      "oklch(71.8% 0.202 349.761)",
    ],
  },
  blue: {
    accent: "oklch(70.7% 0.165 254.624)",
    foreground: DARK_FOREGROUND,
    lightRing: "oklch(23% 0.06 254.624)",
    darkRing: "oklch(85% 0.12 254.624)",
    charts: [
      "oklch(70.7% 0.165 254.624)",
      "oklch(78.9% 0.154 211.53)",
      "oklch(67.3% 0.182 276.935)",
      "oklch(76.5% 0.177 163.223)",
      "oklch(70.2% 0.183 293.541)",
    ],
  },
} as const satisfies Record<string, BrandTheme>;

const FALLBACK_THEMES: readonly BrandTheme[] = [
  BRAND_THEMES.cyan,
  BRAND_THEMES.violet,
  BRAND_THEMES.blue,
  BRAND_THEMES.agiomix,
  BRAND_THEMES.timepiece,
  BRAND_THEMES.grillTime,
];

function parseColor(color: string): Rgb | null {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim());
  if (hex) {
    const value = hex[1].length === 3
      ? [...hex[1]].map((channel) => channel + channel).join("")
      : hex[1];
    return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255) as unknown as Rgb;
  }

  const oklch = /^oklch\(\s*([\d.]+)(%)?\s+([\d.]+)\s+(-?[\d.]+)(?:deg)?\s*\)$/i.exec(color.trim());
  if (!oklch) return null;
  const lightness = Number(oklch[1]) / (oklch[2] ? 100 : 1);
  const chroma = Number(oklch[3]);
  const hue = Number(oklch[4]) * Math.PI / 180;
  if (![lightness, chroma, hue].every(Number.isFinite) || lightness < 0 || lightness > 1 || chroma < 0) return null;

  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((channel) => {
    const clamped = Math.max(0, Math.min(1, channel));
    return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
  }) as unknown as Rgb;
}

function linearChannel(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: Rgb): number {
  return rgb.reduce(
    (sum, channel, index) => sum + linearChannel(channel) * [0.2126, 0.7152, 0.0722][index],
    0,
  );
}

function contrast(first: Rgb, second: Rgb): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const DARK_RGB = parseColor(DARK_FOREGROUND)!;
const LIGHT_RGB = parseColor(LIGHT_FOREGROUND)!;
const BLACK_RGB: Rgb = [0, 0, 0];
const WHITE_RGB: Rgb = [1, 1, 1];
const DARK_SURFACE_RGB: Rgb = [0.09, 0.086, 0.098];

function foregroundFor(rgb: Rgb): string {
  return contrast(rgb, BLACK_RGB) >= contrast(rgb, WHITE_RGB) ? "#000000" : "#ffffff";
}

function rgbCss(rgb: Rgb): string {
  return `rgb(${rgb.map((channel) => Math.round(channel * 255)).join(" ")})`;
}

function mix(first: Rgb, second: Rgb, amount: number): Rgb {
  return first.map((channel, index) => channel * amount + second[index] * (1 - amount)) as unknown as Rgb;
}

function deriveLightRing(rgb: Rgb): string {
  for (let amount = 0.8; amount >= 0; amount -= 0.05) {
    const candidate = mix(rgb, DARK_RGB, amount);
    if (contrast(mix(candidate, [1, 1, 1], 0.5), [1, 1, 1]) >= 3) return rgbCss(candidate);
  }
  return DARK_FOREGROUND;
}

function deriveDarkRing(rgb: Rgb): string {
  for (let amount = 1; amount >= 0; amount -= 0.05) {
    const candidate = mix(rgb, LIGHT_RGB, amount);
    if (contrast(mix(candidate, DARK_SURFACE_RGB, 0.5), DARK_SURFACE_RGB) >= 3) return rgbCss(candidate);
  }
  return LIGHT_FOREGROUND;
}

function hashIdentity(brand: Brand): number {
  let hash = 2166136261;
  const identity = `${brand.slug}:${brand.name}`.toLowerCase();
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function matchesBrand(brand: Brand, name: string, slugs: readonly string[]): boolean {
  return brand.name.trim().toLowerCase() === name || slugs.includes(brand.slug.trim().toLowerCase());
}

export function resolveBrandTheme(brand: Brand): BrandTheme {
  if (/\bag[\s-]+holding\b/i.test(brand.name) || brand.slug.trim().toLowerCase() === "ag-holding") return BRAND_THEMES.ag;
  if (matchesBrand(brand, "agiomix", ["agiomix", "demo-agiomix"])) return BRAND_THEMES.agiomix;
  if (matchesBrand(brand, "timepiece", ["timepiece", "demo-timepiece"])) return BRAND_THEMES.timepiece;
  if (matchesBrand(brand, "grill time", ["grill-time", "grilltime", "demo-grilltime"])) return BRAND_THEMES.grillTime;

  const accent = (brand.primary_color || brand.accent_color || "").trim();
  const rgb = parseColor(accent);
  if (!rgb) return FALLBACK_THEMES[hashIdentity(brand) % FALLBACK_THEMES.length];

  return {
    accent,
    foreground: foregroundFor(rgb),
    lightRing: deriveLightRing(rgb),
    darkRing: deriveDarkRing(rgb),
    charts: [
      accent,
      `color-mix(in oklch, ${accent} 68%, oklch(78.9% 0.154 211.53))`,
      `color-mix(in oklch, ${accent} 62%, oklch(70.2% 0.183 293.541))`,
      `color-mix(in oklch, ${accent} 58%, oklch(76.5% 0.177 163.223))`,
      `color-mix(in oklch, ${accent} 54%, oklch(70.5% 0.213 47.604))`,
    ],
  };
}

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

  useLayoutEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const theme = resolveBrandTheme(active);
    root.style.setProperty("--brand-accent", theme.accent);
    root.style.setProperty("--brand-accent-foreground", theme.foreground);
    root.style.setProperty("--brand-ring-light", theme.lightRing);
    root.style.setProperty("--brand-ring-dark", theme.darkRing);
    root.style.setProperty("--primary", theme.accent);
    root.style.setProperty("--primary-foreground", theme.foreground);
    root.style.setProperty("--sidebar-primary", theme.accent);
    root.style.setProperty("--sidebar-primary-foreground", theme.foreground);
    theme.charts.forEach((color, index) => root.style.setProperty(`--chart-${index + 1}`, color));
  }, [active]);

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
