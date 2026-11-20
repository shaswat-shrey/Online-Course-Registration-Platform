import { GraduationCap } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';
import type { Portal } from '@ucrams/shared';
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
  useSidebar,
} from '@/components/ui/sidebar';
import { useUniversity } from '@/features/system/api/system-queries';
import { useAuthStore } from '@/store/auth-store';
import { NAVIGATION, PORTAL_LABEL } from './nav-config';

export function AppSidebar({ portal }: { portal: Portal }) {
  const permissions = useAuthStore((s) => s.me?.permissions ?? []);
  const { data: university } = useUniversity();
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();

  const groups = NAVIGATION[portal]
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.permission || permissions.includes(i.permission)),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-1 py-1.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <GraduationCap className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold">{university?.shortName ?? 'UCRAMS'}</p>
            <p className="truncate text-xs text-sidebar-foreground/70">
              {PORTAL_LABEL[portal]} portal
            </p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <NavLink to={item.to} onClick={() => setOpenMobile(false)}>
                          <item.icon aria-hidden />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 pb-1 text-[11px] text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
          {university?.name}
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
