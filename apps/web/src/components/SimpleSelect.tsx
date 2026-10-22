import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface Option {
  value: string;
  label: string;
}

/** Radix items can't have an empty value, so "no choice" travels as a sentinel. */
const EMPTY = '__empty__';

/** A shadcn Select that takes a plain list of options (and allows an option whose value is ""). */
export function SimpleSelect({
  value,
  onChange,
  options,
  label,
  className,
  size = 'default',
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  /** Accessible name. */
  label: string;
  className?: string;
  size?: 'sm' | 'default';
  placeholder?: string;
  disabled?: boolean;
}) {
  const known = options.some((o) => o.value === value);
  return (
    <Select value={value === '' ? EMPTY : value} onValueChange={(v) => onChange(v === EMPTY ? '' : v)} disabled={disabled}>
      <SelectTrigger size={size} aria-label={label} className={cn('w-full min-w-0', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {!known && value !== '' && <SelectItem value={value}>{value}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value === '' ? EMPTY : o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
