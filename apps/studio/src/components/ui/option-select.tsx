import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "__default__";

interface Props {
  value: string | undefined;
  /** what the empty choice says, such as "default: false" */
  placeholder: string;
  options: { value: string; label?: string }[];
  onChange: (value: string | undefined) => void;
  testId?: string;
  title?: string;
  className?: string;
}

/**
 * A select with an empty choice. A property left empty means "use the default", which Radix cannot express with an empty
 * string, so the empty choice has a sentinel value of its own.
 */
export function OptionSelect({ value, placeholder, options, onChange, testId, title, className }: Props) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? undefined : v)}>
      <SelectTrigger size="sm" className={className ?? "w-full"} data-testid={testId} title={title}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label ?? o.value}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
