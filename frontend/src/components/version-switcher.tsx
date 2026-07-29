import { Link } from "react-router-dom";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  PaletteIcon,
} from "lucide-react";

import { resolveBrandTheme, useBrand } from "@/brand/BrandContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const APP_NAME = "AG Holding";

function BrandMark({
  name,
  color,
  foreground,
  logo,
}: {
  name: string;
  color: string;
  foreground: string;
  logo?: string | null;
}) {
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        className="size-4 shrink-0 object-contain"
      />
    );
  }
  return (
    <span
      className="grid size-4 shrink-0 place-items-center text-[10px] font-bold"
      style={{ background: color, color: foreground }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Workspace / company switcher (sidebar-02 version switcher pattern). */
export function VersionSwitcher() {
  const { brands, active, setActive } = useBrand();

  const title = active?.name ?? APP_NAME;
  const subtitle = active ? "Company workspace" : "Internal platform";
  const activeTheme = active ? resolveBrandTheme(active) : null;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                tooltip={title}
              />
            }
          >
            <div
              className="flex aspect-square size-8 items-center justify-center border border-sidebar-border"
              style={{
                background: activeTheme?.accent ?? "#facc15",
                color: activeTheme?.foreground ?? "#18181b",
              }}
            >
              {active?.logo_url ? (
                <img
                  src={active.logo_url}
                  alt=""
                  className="size-5 object-contain"
                />
              ) : (
                <span className="text-sm font-bold">{title.slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            <div className="flex flex-col gap-0.5 leading-none">
              <span className="truncate font-medium">{title}</span>
              <span className="truncate text-xs text-sidebar-foreground/75">
                {subtitle}
              </span>
            </div>
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            {brands.length > 0 ? (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Company</DropdownMenuLabel>
                  {brands.map((brand) => {
                    const theme = resolveBrandTheme(brand);
                    return (
                      <DropdownMenuItem
                        key={brand.id}
                        onClick={() => setActive(brand.id)}
                      >
                        <BrandMark
                          name={brand.name}
                          color={theme.accent}
                          foreground={theme.foreground}
                          logo={brand.logo_url}
                        />
                        <span className="min-w-0 flex-1 truncate">{brand.name}</span>
                        {brand.id === active?.id ? (
                          <CheckIcon className="ml-auto" />
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuGroup>
              <DropdownMenuItem
                render={<Link to="/branding" aria-label="Brand Center" />}
              >
                <PaletteIcon />
                Brand Center
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
