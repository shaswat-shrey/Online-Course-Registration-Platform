import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface PickerOption {
  value: string;
  label: string;
  description?: string;
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

interface Props {
  /** Accessible name of the trigger button. */
  label: string;
  value: PickerOption | null;
  onChange: (option: PickerOption | null) => void;
  /** Server search; called with the debounced text. */
  search: (q: string) => Promise<PickerOption[]>;
  /** Cache key prefix for the search query. */
  queryKey: readonly unknown[];
  placeholder?: string;
  exclude?: string[];
  clearable?: boolean;
  invalid?: boolean;
  className?: string;
}

/** Searchable single-select backed by an API search (combobox pattern). */
export function SearchPicker({
  label,
  value,
  onChange,
  search,
  queryKey,
  placeholder = 'Search…',
  exclude = [],
  clearable,
  invalid,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const q = useDebounced(text.trim(), 250);
  const listId = useId();
  const results = useQuery({
    queryKey: [...queryKey, 'picker', q],
    queryFn: () => search(q),
    enabled: open,
    staleTime: 30_000,
  });
  const options = (results.data ?? []).filter((o) => !exclude.includes(o.value));
  const choose = (o: PickerOption) => {
    onChange(o);
    setOpen(false);
    setText('');
  };
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          setActive(0);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            aria-invalid={invalid || undefined}
            className="w-full min-w-0 justify-between font-normal"
          >
            <span className={cn('truncate', !value && 'text-muted-foreground')}>
              {value?.label ?? placeholder}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0">
          <div className="border-b p-2">
            <Input
              autoFocus
              value={text}
              placeholder={placeholder}
              aria-label={`Search ${label.toLowerCase()}`}
              aria-controls={listId}
              aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
              role="combobox"
              aria-expanded
              aria-autocomplete="list"
              onChange={(e) => {
                setText(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, options.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (options[active]) choose(options[active]);
                }
              }}
            />
          </div>
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="max-h-64 overflow-y-auto p-1"
          >
            {results.isFetching && !results.data && (
              <li className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Searching…
              </li>
            )}
            {results.data && options.length === 0 && (
              <li className="p-2 text-sm text-muted-foreground">No matches</li>
            )}
            {options.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={value?.value === o.value}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-sm',
                  i === active && 'bg-accent text-accent-foreground',
                )}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
              >
                <Check
                  className={cn(
                    'mt-0.5 size-4 shrink-0',
                    value?.value === o.value ? 'opacity-100' : 'opacity-0',
                  )}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.description && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {o.description}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      {clearable && value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={() => onChange(null)}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
