import type { PermissionDef } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type OverrideValue = { allow: string[]; deny: string[] };

/** Group catalogue entries by their area, keeping catalogue order. */
export function groupPermissions(permissions: PermissionDef[]) {
  const groups = new Map<string, PermissionDef[]>();
  for (const permission of permissions) {
    groups.set(permission.group, [...(groups.get(permission.group) ?? []), permission]);
  }
  return [...groups.entries()];
}

/**
 * Per-permission allow/deny on top of what a person's roles already grant.
 * "Role" keeps the role's answer; "Allow" adds the permission; "Deny" removes
 * it even when a role grants it (a deny always wins).
 */
export function PermissionOverrides({ permissions, granted, value, onChange, disabled = false }: {
  permissions: PermissionDef[];
  /** Permissions the person's roles already grant. */
  granted: Set<string>;
  value: OverrideValue;
  onChange: (next: OverrideValue) => void;
  disabled?: boolean;
}) {
  function set(key: string, choice: string) {
    const allow = value.allow.filter((item) => item !== key);
    const deny = value.deny.filter((item) => item !== key);
    if (choice === "allow") allow.push(key);
    if (choice === "deny") deny.push(key);
    onChange({ allow, deny });
  }

  return <div className="flex flex-col gap-5">
    {groupPermissions(permissions).map(([group, items]) => <FieldSet key={group}>
      <FieldLegend variant="label">{group}</FieldLegend>
      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {items.map((permission) => {
          const choice = value.deny.includes(permission.key) ? "deny" : value.allow.includes(permission.key) ? "allow" : "role";
          const effective = choice === "allow" || (choice === "role" && granted.has(permission.key));
          const labelId = `override-${permission.key.replace(/\W/g, "-")}`;
          return <li key={permission.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p id={labelId} className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {permission.label}
                <Badge variant={effective ? "success" : "outline"}>{effective ? "Has it" : "Doesn't have it"}</Badge>
              </p>
              <FieldDescription>{permission.description}</FieldDescription>
            </div>
            <ToggleGroup variant="outline" value={[choice]} disabled={disabled} aria-labelledby={labelId}
              onValueChange={(values) => values[0] && set(permission.key, values[0])}>
              <ToggleGroupItem value="role">{granted.has(permission.key) ? "Role: yes" : "Role: no"}</ToggleGroupItem>
              <ToggleGroupItem value="allow">Allow</ToggleGroupItem>
              <ToggleGroupItem value="deny">Deny</ToggleGroupItem>
            </ToggleGroup>
          </li>;
        })}
      </ul>
    </FieldSet>)}
  </div>;
}
