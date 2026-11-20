import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthBootstrap } from './auth-bootstrap';
import { createQueryClient } from './query-client';
import { ThemeSync } from './theme-sync';

export function AppProviders({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={200}>
        <ThemeSync />
        <AuthBootstrap>{children}</AuthBootstrap>
        <Toaster richColors closeButton position="top-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
