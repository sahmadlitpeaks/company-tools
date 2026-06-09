import { Check, Monitor, Moon, Sun } from "lucide-react";
import { ACCENT_PRESETS, type Appearance } from "./ThemeContext";

/** Presentational appearance picker, reused for personal + org-default editing. */
export default function AppearanceControls({
  value,
  onChange,
}: {
  value: Appearance;
  onChange: <K extends keyof Appearance>(key: K, v: Appearance[K]) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label>Theme</label>
        <Segmented
          value={value.mode}
          onChange={(v) => onChange("mode", v as Appearance["mode"])}
          options={[
            { value: "light", label: "Light", icon: <Sun size={15} /> },
            { value: "dark", label: "Dark", icon: <Moon size={15} /> },
            { value: "system", label: "System", icon: <Monitor size={15} /> },
          ]}
        />
      </div>

      <div>
        <label>Accent colour</label>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch ${value.accent.toLowerCase() === c ? "selected" : ""}`}
              style={{ background: c }}
              title={c}
              aria-label={`Accent ${c}`}
              onClick={() => onChange("accent", c)}
            >
              {value.accent.toLowerCase() === c && (
                <Check size={15} className="mx-auto text-white" />
              )}
            </button>
          ))}
          <label
            className="swatch grid place-items-center overflow-hidden"
            style={{ background: "conic-gradient(red,orange,yellow,green,blue,violet,red)" }}
            title="Custom colour"
          >
            <input
              type="color"
              value={value.accent}
              onChange={(e) => onChange("accent", e.target.value)}
              className="h-9 w-9 cursor-pointer opacity-0"
            />
          </label>
        </div>
      </div>

      <div>
        <label>Density</label>
        <Segmented
          value={value.density}
          onChange={(v) => onChange("density", v as Appearance["density"])}
          options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]}
        />
      </div>

      <div>
        <label>Font</label>
        <Segmented
          value={value.font}
          onChange={(v) => onChange("font", v as Appearance["font"])}
          options={[
            { value: "system", label: "System" },
            { value: "inter", label: "Inter" },
            { value: "serif", label: "Serif" },
          ]}
        />
      </div>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div
      className="inline-flex flex-wrap gap-1 rounded-[10px] p-1"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`btn-sm inline-flex items-center gap-1.5 ${active ? "btn-primary" : ""}`}
            style={
              active
                ? undefined
                : { background: "transparent", border: "1px solid transparent" }
            }
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
