# Frontend Components And AI Usage

This is the frontend source of truth for people and coding agents. Read it
before creating or changing a page. It documents the current component system,
how each component family is used, and which old patterns must not return.

## Stack And Sources

- React 19 SPA with Vite and TypeScript.
- Tailwind CSS v4 theme in `frontend/src/styles.css`.
- shadcn style `base-lyra`, backed by Base UI, configured in
  `frontend/components.json`.
- Lucide icons and DM Sans.
- Primitive source: `frontend/src/components/ui/*.tsx`.
- Product/shared components: `frontend/src/components/`.
- Conditional class helper: `cn()` from `@/lib/utils`.

The design uses semantic theme variables, company-controlled accents, and
square rectangular surfaces. Use `bg-background`, `bg-card`, `bg-muted`,
`text-foreground`, `text-muted-foreground`, `text-destructive`, `border-border`,
`bg-primary`, and `text-primary-foreground`. Do not use raw palette colors or
hex values for normal application chrome.

## Building A Page

1. Add a lazy page import and protected route in `frontend/src/App.tsx`.
2. Add permission-aware navigation in `frontend/src/components/navigation.ts`
   when the page belongs in navigation.
3. Put shared API types in `frontend/src/api/types.ts`; use `api()` for
   mutations and `useFetch()` for normal GET state.
4. Start with `PageHead`, then compose installed primitives directly from
   `@/components/ui/<component>`.
5. Design loading, error, empty, success, validation, and permission states.
6. Verify desktop and Pixel 5 mobile layouts. Use cards on mobile and tables on
   desktop for dense row data when needed.
7. Add focused Playwright behavior and accessibility coverage.
8. Run typecheck, build, React Doctor, and relevant tests.

Example page skeleton:

```tsx
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, ErrorState, Loading, PageHead } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";

export default function ExamplePage() {
  const records = useFetch<Record[]>("/api/records");

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        title="Records"
        subtitle="Manage the current records."
        action={
          <Button type="button">
            <Plus data-icon="inline-start" aria-hidden="true" />
            New record
          </Button>
        }
      />
      <Card>
        <CardHeader><CardTitle>Library</CardTitle></CardHeader>
        <CardContent>
          {records.error ? (
            <ErrorState message={records.error} onRetry={records.reload} />
          ) : records.loading ? (
            <Loading />
          ) : records.data?.length ? (
            <RecordList records={records.data} />
          ) : (
            <Empty message="No records yet" hint="Create the first record." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

`@/components/ui` in this example resolves to the compatibility/product
composition file `src/components/ui.tsx`. Primitive imports always use the
explicit subpath, such as `@/components/ui/button`.

## Installed Primitive Inventory

The source files are authoritative. When this list may have changed, run
`git ls-files "frontend/src/components/ui/*.tsx"`.

| Need | Components | How to use |
| --- | --- | --- |
| Actions | `Button` | Primary action uses default; secondary uses `outline`; low-emphasis action uses `ghost`; dangerous action uses `destructive`. Use `Spinner` plus `disabled` while submitting. |
| Status | `Badge` | Use semantic variants `secondary`, `success`, `warning`, `info`, `destructive`, or `outline`. Do not build colored status spans. |
| Callout | `Alert`, `AlertTitle`, `AlertDescription`, `AlertAction` | Use for inline information and recoverable errors. Use `variant="destructive"` for failures. |
| Empty state | `Empty`, `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, `EmptyContent` | Use when a valid query has no results. Put the recovery/create action in `EmptyContent`. |
| Loading | `Skeleton`, `Spinner`, `Progress` family | Skeleton for page/list shape, Spinner inside a submitting button, Progress for measurable completion. |
| Text controls | `Input`, `Textarea` | Always associate with a field label. Add `aria-invalid` when invalid. |
| Form structure | `FieldGroup`, `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldSet`, `FieldLegend`, `FieldSeparator`, `FieldContent`, `FieldTitle` | Use for form spacing, grouping, descriptions, and validation. Put `data-invalid` on `Field` and `aria-invalid` on its control. |
| Input adornments | `InputGroup`, `InputGroupAddon`, `InputGroupButton`, `InputGroupText`, `InputGroupInput`, `InputGroupTextarea` | Use for an icon, unit, or action inside an input. Do not put a plain `Input` inside `InputGroup`. |
| Selection list | `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectLabel`, `SelectSeparator` | Use instead of native `<select>`. Every item belongs in a group. This is Base UI; follow the local API rather than Radix examples. |
| Small option set | `ToggleGroup`, `ToggleGroupItem` | Use for two to seven mutually exclusive or multi-select options instead of an active-styled button loop. |
| Boolean | `Checkbox`, `Switch` | Checkbox for choosing items/acknowledgement; Switch for an immediate on/off setting. |
| Single toggle | `Toggle` | Use for one pressable state, such as pinning or formatting, not for normal submit actions. |
| Date selection | `Calendar`, `CalendarDayButton` | Use for a visible calendar/date-picker composition. Date formatting and date math use `date-fns`. |
| Content surface | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter` | Use full composition; do not put the title and actions loose in `CardContent`. |
| Data table | `TableSurface`, `Table`, `TableHeader`, `TableBody`, `TableHead`, `TableRow`, `TableCell`, `TableFooter`, `TableCaption`, `TableEmptyRow` | Use `TableSurface` for the bordered container. Provide a mobile card/list alternative when columns do not fit. |
| Identity | `Avatar`, `AvatarImage`, `AvatarFallback`, `AvatarBadge`, `AvatarGroup`, `AvatarGroupCount` | Always provide fallback initials/text. Rounded avatar shape is intentional. |
| Tabs | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | Triggers always live in `TabsList`; preserve keyboard selection. |
| Disclosure | `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` | Use for a simple expandable section. |
| Breadcrumbs | `Breadcrumb` family | The app shell owns route breadcrumbs. Use locally only for a genuine nested navigation hierarchy. |
| Dialog | `Dialog` family | Use for create/edit/detail workflows. Every dialog needs `DialogTitle` and `DialogDescription`, with `sr-only` when visually hidden. |
| Confirmation | `AlertDialog` family | Use for destructive or consequential confirmation, never `window.confirm`. |
| Side panel | `Sheet` family | Use when context should remain visible behind a side panel. Every sheet needs a title. |
| Popover | `Popover` family | Use for anchored non-destructive content such as compact filters or pickers. |
| Menu | `DropdownMenu` family | Use for a compact action menu; menu items belong in a group. |
| Command/search | `Command` family | Use for searchable action/entity lists and command-palette compositions. |
| Tooltip | `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` | Use only for supplementary information. Do not hide required instructions in a tooltip. |
| Layout | `Separator` | Use instead of `<hr>` or a custom border-only divider. |
| Notifications | `Toaster` with Sonner | The root `ToastProvider` mounts it. Existing code uses `useToast().notify`; new isolated code may use Sonner consistently when no app wrapper is needed. |
| Navigation shell | `Sidebar` family | Used by `app-sidebar.tsx`; extend that composition rather than creating another shell. |

Components not currently installed include chart, scroll area, accordion,
drawer, pagination, radio group, slider, and combobox. Do not import them by
assumption. Use the tracked shadcn skill to inspect and deliberately add a
component only when shipped code requires it.

## Form Pattern

```tsx
<FieldGroup>
  <Field data-invalid={Boolean(error) || undefined}>
    <FieldLabel htmlFor="record-name">Name</FieldLabel>
    <Input
      id="record-name"
      value={name}
      onChange={(event) => setName(event.target.value)}
      aria-invalid={Boolean(error) || undefined}
    />
    <FieldDescription>Use the name employees will recognize.</FieldDescription>
    {error ? <FieldError>{error}</FieldError> : null}
  </Field>
</FieldGroup>
```

For a select:

```tsx
<Field>
  <FieldLabel htmlFor="record-team">Team</FieldLabel>
  <Select value={team} onValueChange={(value) => setTeam(value ?? "it")}>
    <SelectTrigger id="record-team"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectGroup>
        <SelectItem value="it">IT</SelectItem>
        <SelectItem value="facilities">Facilities</SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
</Field>
```

## Product And Shared Components

| Component/file | Use |
| --- | --- |
| `Layout.tsx` | Authenticated shell and route outlet. Do not wrap pages in another shell. |
| `app-sidebar.tsx`, `navigation.ts` | Permission-aware main navigation and route titles. Add modules here rather than hardcoding links in the shell. |
| `CommandPalette.tsx` | Global searchable navigation/actions. Extend its existing source model for globally searchable features. |
| `NotificationBell.tsx` | Notification display and read actions. |
| `Attachments.tsx` | Generic upload/list/delete and camera entry for supported entity types. Routine Check evidence uses `entityType="task_item"`, `camera`, `accept="image/*"`, and `capture="environment"`. |
| `CameraCapture.tsx` | Live camera viewfinder, downscale, review, retake, and upload. Normally use it through `Attachments`, not in parallel with another file input. |
| `SavedViews.tsx` | Saved filter/view state for list surfaces. |
| `PdfThumb.tsx`, `FlipbookModal.tsx` | Authenticated PDF preview and document viewer. |
| `VersionsModal.tsx` | Version history for versioned documents. |
| `ShareControl.tsx` | Existing share-link lifecycle; do not duplicate share controls per page. |
| `ErrorBoundary.tsx` | Top-level render crash fallback. Add local boundaries only around genuinely isolated, crash-prone subtrees. |
| `dashboard/DashboardCards.tsx` | Existing dashboard card compositions and reorderable widget examples. |
| `org-chart/OrgChartFlow.tsx` | React Flow organization chart; use only for the organization graph. |

## Compatibility Compositions

`frontend/src/components/ui.tsx` contains shadcn-backed compatibility and
product-level helpers used by older pages:

- `PageHead`: page title, subtitle, and responsive action area.
- `Modal`: existing always-open dialog composition.
- `ConfirmDialog`: async confirmation with error handling.
- `PromptModal`: one-input prompt replacement.
- `ToastProvider`, `useToast`: app notification adapter.
- `Loading`, `ListSkeleton`, `ErrorBox`, `ErrorState`, `Empty`: standard async
  states.
- `MetricCard`, `MetricStrip`, `MiniBars`: lightweight metrics.
- `AuthImage` and `bytes`: shared utilities.

Reuse these when they fit an existing workflow, but do not add new primitive
controls or arbitrary wrappers to this file. New primitives belong under
`components/ui/`; reusable product behavior belongs in a clearly named file
under `components/`.

## API And Async State

Normal SPA requests use the HttpOnly session cookie:

```tsx
const records = useFetch<Record[]>("/api/records");

async function createRecord(payload: RecordCreate) {
  await api<Record>("/api/records", { method: "POST", body: payload });
  await records.reload();
}
```

- Use `path = null` to pause `useFetch` until an ID or permission is available.
- Display `error`, `loading`, valid empty data, and loaded data separately.
- Do not call `fetch` directly for normal API work; the shared client supplies
  the same-origin base and credentials.
- Use `apiBlob()`/`downloadFile()` for authenticated binary resources.
- Backend permission checks remain mandatory even when the route is protected
  in React.

## Never Use The Old System

Do not create or copy:

- Legacy classes: `.card`, `.row`, `.spread`, `.badge`, `.btn`, `.btn-primary`,
  `.btn-danger`, `.btn-sm`, `.field`, `.modal`, `.empty`, `.toast`, `.muted`.
- Raw page-level `<button>` or `<select>` used as styled app controls.
- Styled-div cards, tables, badges, alerts, empty states, skeletons, menus, or
  modal overlays.
- `window.alert`, `window.confirm`, or `window.prompt`.
- Raw status colors such as green/red/amber utility classes where a semantic
  `Badge`, `Alert`, or token exists.
- Radix UI imports or Radix-only `asChild` examples in this Base UI project.
- New barrel exports for every primitive.
- Unused generated components.
- Rounded page-level app chrome.

## Validation Commands

From `frontend/`:

```bash
npm run typecheck
npm run build
npm run doctor
npm run test:e2e -- e2e/<focused-test>.spec.ts
```

React Doctor is required after substantial frontend changes and before a
substantial frontend commit or pull request. Read
`.agents/skills/company-tools-react-doctor/SKILL.md`; do not merely record the
score without reviewing diagnostics.
