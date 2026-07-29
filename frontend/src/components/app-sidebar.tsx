import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRightIcon } from "lucide-react";

import { VersionSwitcher } from "@/components/version-switcher";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { currentNavSection, isNavItemActive, visibleNavGroups } from "./navigation";

export function AppSidebar({
  isAdmin,
  can,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  isAdmin: boolean;
  can: (module: string) => boolean;
}) {
  const location = useLocation();
  const groups = React.useMemo(
    () => visibleNavGroups(isAdmin, can),
    [isAdmin, can],
  );
  const activeSection = currentNavSection(location.pathname);
  const [openSections, setOpenSections] = React.useState<Set<string>>(
    () => new Set(groups.map((group) => group.section)),
  );

  React.useEffect(() => {
    if (!activeSection) return;
    setOpenSections((previous) => new Set(previous).add(activeSection));
  }, [activeSection]);

  function setSectionOpen(section: string, open: boolean) {
    setOpenSections((previous) => {
      if (!open) {
        const next = new Set(previous);
        next.delete(section);
        return next;
      }
      return new Set(previous).add(section);
    });
  }

  return (
    <Sidebar collapsible="icon" aria-label="Primary" {...props}>
      <SidebarHeader>
        <VersionSwitcher />
      </SidebarHeader>
      <SidebarContent className="gap-1 px-1 pb-2">
        {groups.map((group) => {
          const open = openSections.has(group.section);
          return (
            <Collapsible
              key={group.section}
              open={open}
              onOpenChange={(next) => setSectionOpen(group.section, next)}
              className="group/collapsible"
            >
              <SidebarGroup className="p-1">
                <SidebarGroupLabel
                  className="group/label h-9 cursor-pointer gap-2 px-2.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  render={<CollapsibleTrigger />}
                >
                  <span className="truncate group-data-[collapsible=icon]:hidden">{group.section}</span>
                  <ChevronRightIcon className="ml-auto transition-transform group-data-open/collapsible:rotate-90 group-data-[collapsible=icon]:hidden" />
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => {
                        const active = isNavItemActive(location.pathname, item);
                        return (
                          <SidebarMenuItem key={item.to}>
                            <SidebarMenuButton
                              isActive={active}
                              tooltip={item.label}
                              render={
                                <Link
                                  to={item.to}
                                  aria-label={item.label}
                                  title={item.label}
                                />
                              }
                            >
                              <item.icon strokeWidth={1.5} />
                              <span>{item.label}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2 text-xs leading-relaxed text-sidebar-foreground/75 group-data-[collapsible=icon]:hidden">
          {groups.reduce((total, group) => total + group.items.length, 0)} tools · all searchable
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
