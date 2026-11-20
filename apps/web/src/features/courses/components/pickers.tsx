import { SearchPicker, type PickerOption } from '@/components/forms/search-picker';
import { DESIGNATION_LABEL } from '@/features/people/api/types';
import { apiGetPage } from '@/services/http';
import type { Course } from '../api/types';

export const courseOption = (c: { id: string; code: string; title: string }): PickerOption => ({
  value: c.id,
  label: `${c.code} · ${c.title}`,
});

interface PickerProps {
  label: string;
  value: PickerOption | null;
  onChange: (o: PickerOption | null) => void;
  exclude?: string[];
  clearable?: boolean;
  invalid?: boolean;
  className?: string;
}

/** Course search over code, title and description (full-text on the server). */
export function CoursePicker({
  filter = {},
  ...props
}: PickerProps & { filter?: Record<string, string> }) {
  return (
    <SearchPicker
      {...props}
      placeholder="Search by code or title…"
      queryKey={['catalog', 'course-picker', filter]}
      search={async (q) => {
        const page = await apiGetPage<Course>('/courses', {
          params: { q: q || undefined, limit: 20, ...filter },
        });
        return page.data.map((c) => ({
          ...courseOption(c),
          description: `${c.department.code} · ${c.credits} credits${c.status !== 'ACTIVE' ? ` · ${c.status.toLowerCase()}` : ''}`,
        }));
      }}
    />
  );
}

interface FacultyRow {
  id: string;
  firstName: string;
  lastName: string;
  designation: string;
  department: { code: string };
}

/** Faculty directory search (active members). */
export function FacultyPicker({
  filter = {},
  ...props
}: PickerProps & { filter?: Record<string, string> }) {
  return (
    <SearchPicker
      {...props}
      placeholder="Search faculty by name…"
      queryKey={['people', 'faculty-picker', filter]}
      search={async (q) => {
        const page = await apiGetPage<FacultyRow>('/faculty/directory', {
          params: { q: q || undefined, limit: 20, employmentStatus: 'ACTIVE', ...filter },
        });
        return page.data.map((f) => ({
          value: f.id,
          label: `${f.firstName} ${f.lastName}`,
          description: `${DESIGNATION_LABEL[f.designation] ?? f.designation} · ${f.department.code}`,
        }));
      }}
    />
  );
}
