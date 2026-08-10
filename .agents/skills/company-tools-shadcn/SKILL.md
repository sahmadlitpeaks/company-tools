---
name: company-tools-shadcn
description: Build and maintain this repository's React UI with its installed shadcn components, Base UI primitives, Tailwind semantic tokens, and base-lyra conventions. Use for any frontend component, page, form, dialog, table, navigation, or styling work.
---

# shadcn for Company Tools

This is a repository-specific shadcn skill. The authoritative project rules and
component inventory are in `docs/FRONTEND_COMPONENTS.md`.

## Required Workflow

1. Read `AGENTS.md`, `docs/FRONTEND_COMPONENTS.md`,
   `frontend/components.json`, and the nearest existing screen with a similar
   workflow.
2. Work from `frontend/` for shadcn CLI commands.
3. Inspect installed components before creating or adding anything. Use the
   npm package runner because this repository uses `package-lock.json`:

   ```bash
   npx shadcn@latest info
   npx shadcn@latest docs <component>
   ```

4. Reuse an installed component from `@/components/ui/<component>` whenever it
   fits. Compose primitives instead of rebuilding controls with styled markup.
5. If a component is not installed, preview it before adding it:

   ```bash
   npx shadcn@latest add <component> --dry-run
   npx shadcn@latest add <component> --diff <file>
   ```

6. Never use `--overwrite` without explicit user approval. Read and review all
   generated files after adding them.
7. Run typecheck, build, focused Playwright coverage, and the repository React
   Doctor skill after substantial UI work.

## Project Invariants

- Style: `base-lyra`; primitive base: Base UI; framework: Vite SPA.
- Use Base UI's `render` composition API, not Radix `asChild` assumptions.
- Use Lucide icons and `data-icon="inline-start|inline-end"` inside buttons.
- Use semantic tokens such as `bg-card`, `text-muted-foreground`, and
  `text-destructive`; do not hardcode application chrome colors.
- The normal rectangular interface is deliberately square. Do not add rounded
  cards, fields, tables, dialogs, or badges. Avatars and switches are shape
  exceptions.
- Forms use `FieldGroup`, `Field`, `FieldLabel`, and validation semantics.
- Small option sets use `ToggleGroup`; selection lists use `Select` with
  `SelectGroup` and `SelectItem`.
- Use `Alert`, `Empty`, `Skeleton`, `Badge`, `Table`, `Dialog`, and
  `AlertDialog` instead of hand-built equivalents.
- Never add native page-level `<select>`, raw styled buttons, legacy `.card`,
  `.row`, `.badge`, `.btn`, `.btn-primary`, or `.btn-danger` patterns.
- Import primitives directly from `@/components/ui/<component>`. Do not turn
  `src/components/ui.tsx` into a primitive barrel or a second design system.
- Add only components used by shipped code; unused generated files create dead
  code and React Doctor findings.
