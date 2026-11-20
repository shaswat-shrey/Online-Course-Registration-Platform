import { Outlet } from 'react-router';
import type { Portal } from '@ucrams/shared';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/navigation/app-sidebar';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { PortalSwitcher } from '@/components/navigation/portal-switcher';
import { UserMenu } from '@/components/navigation/user-menu';
import { MessagesButton, RealtimeBridge } from '@/features/communication/realtime';
import { NotificationsBell } from '@/features/notifications/notifications-bell';
import { GlobalSearch } from '@/features/platform/components/global-search';
import { PortalBanner } from '@/features/platform/components/portal-banner';

export function PortalLayout({ portal }: { portal: Portal }) {
  return (
    <SidebarProvider>
      <RealtimeBridge />
      <AppSidebar portal={portal} />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur sm:px-4">
          <SidebarTrigger aria-label="Toggle navigation" />
          <Separator orientation="vertical" className="mr-1 h-5" />
          <div className="min-w-0 flex-1">
            <Breadcrumbs />
          </div>
          <GlobalSearch portal={portal} />
          <PortalSwitcher portal={portal} />
          <MessagesButton portal={portal} />
          <NotificationsBell />
          <ThemeToggle />
          <UserMenu portal={portal} />
        </header>
        <PortalBanner />
        <main
          id="main"
          className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8"
        >
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
