import { Search } from 'lucide-react';
import { Input } from '@/shared/ui/primitives/input';

export function ListSearch({ value, onChange, label }: { value: string; onChange: (next: string) => void; label: string }) {
  return (
    <div className="relative">
      <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        className="w-full border-input pl-9"
      />
    </div>
  );
}
