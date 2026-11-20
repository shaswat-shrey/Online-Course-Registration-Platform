import { Loader2, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Portal, SearchType } from '@ucrams/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/services/api-error';
import { useGlobalSearch, type SearchHit } from '../api/platform-queries';

const GROUP_LABEL: Record<SearchType, string> = {
  course: 'Courses',
  department: 'Departments',
  program: 'Programs',
  specialization: 'Specializations',
  faculty: 'Faculty',
  student: 'Students',
};

/** Where a result opens in each portal; null when the portal has no page for it. */
export function hitLink(portal: Portal, hit: SearchHit): string | null {
  if (portal === 'admin') {
    const base: Record<SearchType, string> = {
      course: 'courses',
      department: 'departments',
      program: 'programs',
      specialization: 'programs',
      faculty: 'faculty',
      student: 'students',
    };
    return `/admin/${base[hit.type]}/${hit.id}`;
  }
  if (portal === 'student' && hit.type === 'course') return `/student/catalog/${hit.id}`;
  return null;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Header search across the catalog, structure and people (FR-SRCH-001/002). */
export function GlobalSearch({ portal }: { portal: Portal }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const result = useGlobalSearch(open ? q : '');
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (to: string) => {
    setOpen(false);
    setText('');
    void navigate(to);
  };
  const groups = result.data?.groups ?? [];
  const firstLink = groups
    .flatMap((g) => g.items)
    .map((h) => hitLink(portal, h))
    .find(Boolean);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-label="Search"
      >
        <Search className="size-4" />
        <span className="hidden md:inline">Search</span>
        <kbd className="hidden rounded border bg-muted px-1 text-[10px] md:inline">⌘K</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[15%] translate-y-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Search</DialogTitle>
            <DialogDescription>Courses, departments, programs and people.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (firstLink) go(firstLink);
            }}
          >
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type at least 2 characters"
                className="pl-8"
                aria-label="Search terms"
              />
              {result.isFetching && (
                <Loader2 className="absolute top-2.5 right-2.5 size-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </form>
          <div className="max-h-[50dvh] overflow-y-auto" aria-live="polite">
            {result.isError ? (
              <p className="py-4 text-sm text-destructive">{errorMessage(result.error)}</p>
            ) : q.trim().length < 2 ? null : result.data && result.data.total === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing found for “{q.trim()}”.
              </p>
            ) : (
              groups.map((g) => (
                <section key={g.type} className="py-2">
                  <h3 className="px-1 pb-1 text-xs font-medium text-muted-foreground uppercase">
                    {GROUP_LABEL[g.type]}
                  </h3>
                  <ul>
                    {g.items.map((hit) => {
                      const to = hitLink(portal, hit);
                      const body = (
                        <>
                          <span className="block truncate text-sm">{hit.title}</span>
                          {hit.subtitle && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {hit.subtitle}
                            </span>
                          )}
                        </>
                      );
                      return (
                        <li key={`${hit.type}-${hit.id}-${hit.title}`}>
                          {to ? (
                            <button
                              type="button"
                              onClick={() => go(to)}
                              className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                            >
                              {body}
                            </button>
                          ) : (
                            <div className="px-2 py-1.5">{body}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
