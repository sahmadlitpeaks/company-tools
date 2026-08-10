import { Link } from "react-router-dom";
import { Check, ChevronDown, Palette } from "lucide-react";
import { resolveBrandTheme, useBrand } from "./BrandContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function Swatch({ color, src }: { color: string; src?: string | null }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="size-5 shrink-0 object-contain"
      />
    );
  }
  return (
    <span
      className="size-4 shrink-0 ring-1 ring-foreground/20"
      style={{ background: color }}
    />
  );
}

export default function BrandSwitcher() {
  const { brands, active, setActive } = useBrand();

  if (!active) return null;
  const activeTheme = resolveBrandTheme(active);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2 px-2.5"
            aria-label="Switch company"
            title="Switch company"
          />
        }
      >
        <Swatch color={activeTheme.accent} src={active.logo_url} />
        <span className="hidden max-w-[140px] truncate text-sm font-medium sm:block">
          {active.name}
        </span>
        <ChevronDown data-icon="inline-end" className="opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Company</DropdownMenuLabel>
          {brands.map((brand) => {
            const theme = resolveBrandTheme(brand);
            return (
              <DropdownMenuItem key={brand.id} onClick={() => setActive(brand.id)}>
                <Swatch color={theme.accent} src={brand.logo_url} />
                <span className="min-w-0 flex-1 truncate">{brand.name}</span>
                {brand.id === active.id ? <Check className="text-foreground" /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            render={<Link to="/branding" aria-label="Brand Center" />}
          >
            <Palette />
            Brand Center
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
