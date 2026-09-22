import { useEffect, useMemo, useState } from "react";
import { PowerOff, SearchX, ToggleLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog, Empty, ListSkeleton, useToast } from "./ui";

interface FeatureToggle {
  key: string;
  label: string;
  /** False when the feature itself is off, or when its module is. */
  enabled: boolean;
  /** True only when the feature has been switched off in its own right. */
  self_disabled: boolean;
}

interface ModuleToggle {
  key: string;
  label: string;
  enabled: boolean;
  /** The dashboard: present for completeness, but never switchable. */
  locked: boolean;
  features: FeatureToggle[];
}

interface ModuleToggleState {
  modules: ModuleToggle[];
  disabled: string[];
}

/**
 * Org-wide module and feature switches.
 *
 * Separate from Departments & Access, which decides *who* may use a module.
 * This decides whether a module exists at all — a module switched off here is
 * gone for every team and every person, administrators included, in the
 * navigation, on its routes, and in the API. Nothing is deleted; switching it
 * back on restores it untouched.
 */
export default function ModuleToggles() {
  const { notify } = useToast();
  const { refresh } = useAuth();
  const [state, setState] = useState<ModuleToggleState | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<{ key: string; label: string } | null>(null);

  useEffect(() => {
    api<ModuleToggleState>("/api/settings/modules")
      .then(setState)
      .catch(() => setFailed(true));
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!state) return [];
    if (!needle) return state.modules;
    return state.modules.filter(
      (m) =>
        m.label.toLowerCase().includes(needle) ||
        m.key.includes(needle) ||
        m.features.some((f) => f.label.toLowerCase().includes(needle)),
    );
  }, [state, query]);

  async function apply(key: string, enabled: boolean) {
    if (!state) return;
    const disabled = new Set(state.disabled);
    if (enabled) disabled.delete(key);
    else disabled.add(key);
    setSaving(key);
    try {
      const next = await api<ModuleToggleState>("/api/settings/modules", {
        method: "PUT",
        body: { disabled: [...disabled] },
      });
      setState(next);
      // Re-read the session so navigation and routing pick the change up
      // straight away rather than on the next sign-in.
      await refresh();
      notify(enabled ? "Turned back on for everyone." : "Turned off for everyone.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not save", "error");
    } finally {
      setSaving(null);
    }
  }

  /** Switching something off hides it company-wide, so confirm that direction. */
  function toggle(key: string, label: string, enabled: boolean) {
    if (enabled) void apply(key, true);
    else setPending({ key, label });
  }

  const offCount = state?.disabled.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ToggleLeft aria-hidden="true" /> Modules &amp; features
        </CardTitle>
        <CardDescription>
          Switch a whole module, or one feature inside it, on or off for the
          entire company. Anything switched off disappears from the menu and its
          pages for every team — including administrators — and its API stops
          answering. No data is deleted, so switching it back on restores it.
          Who may use a module that is on is still decided in{" "}
          <strong>Departments &amp; Access</strong>.
        </CardDescription>
        {offCount > 0 && (
          <CardAction>
            <Badge variant="warning">
              <PowerOff data-icon="inline-start" aria-hidden="true" />
              {offCount} switched off
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {failed && (
          <p className="text-sm text-destructive">
            Could not load the module list. Reload the page to try again.
          </p>
        )}
        {!state && !failed && <ListSkeleton rows={6} />}

        {state && (
          <>
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modules and features…"
              aria-label="Search modules and features"
            />

            {visible.length === 0 ? (
              <Empty
                icon={<SearchX aria-hidden="true" />}
                message="No matching modules"
                hint="Try a different name."
              />
            ) : (
              <ul className="divide-y divide-border border border-border">
                {visible.map((m) => (
                  <li key={m.key} className="grid gap-3 p-3">
                    <div className="flex items-start gap-3">
                      <Switch
                        checked={m.enabled}
                        disabled={m.locked || saving !== null}
                        aria-label={`Turn ${m.label} ${m.enabled ? "off" : "on"} for everyone`}
                        onCheckedChange={(on) => toggle(m.key, m.label, on)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-foreground">
                            {m.label}
                          </span>
                          {m.locked && <Badge variant="outline">Always on</Badge>}
                          {!m.enabled && !m.locked && (
                            <Badge variant="warning">Off for everyone</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{m.key}</p>
                      </div>
                    </div>

                    {m.features.length > 0 && (
                      <ul className="ml-0 grid gap-2 border-l-2 border-border pl-4 sm:ml-9">
                        {m.features.map((f) => (
                          <li key={f.key} className="flex items-start gap-3">
                            <Switch
                              // A feature off only because its module is stays
                              // in its own state, so the module coming back on
                              // restores it exactly as the admin left it.
                              checked={!f.self_disabled}
                              disabled={!m.enabled || saving !== null}
                              aria-label={`Turn ${f.label} ${
                                f.self_disabled ? "on" : "off"
                              } for everyone`}
                              onCheckedChange={(on) => toggle(f.key, f.label, on)}
                            />
                            <div className="min-w-0 flex-1">
                              <span className="text-sm text-foreground">
                                {f.label}
                              </span>
                              {!m.enabled && (
                                <p className="text-xs text-muted-foreground">
                                  Unavailable while {m.label} is off
                                </p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>

      {pending && (
        <ConfirmDialog
          title={`Turn off ${pending.label}?`}
          message={
            <>
              <strong>{pending.label}</strong> will disappear for everyone in the
              company, administrators included, and its pages will stop loading.
              Nothing is deleted — you can switch it back on here at any time.
            </>
          }
          confirmLabel="Turn off"
          danger
          onConfirm={() => apply(pending.key, false)}
          onClose={() => setPending(null)}
        />
      )}
    </Card>
  );
}
