import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export interface SideTab {
  value: string;
  label: string;
  /** Number shown next to the label. */
  count?: number;
  danger?: boolean;
  content: ReactNode;
}

/** The right-hand tab strip shared by the editor and the read-only viewer. */
export function SidePanel({ tabs, value, onChange }: { tabs: SideTab[]; value: string; onChange: (v: string) => void }) {
  return (
    <aside className="flex min-h-0 flex-col border-l bg-card">
      <Tabs value={value} onValueChange={onChange} className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="m-2 grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              {!!t.count && (
                <Badge className={cn('h-4 min-w-4 rounded-full px-1 text-[10px] text-white', t.danger ? 'bg-destructive' : 'bg-amber-600')}>{t.count}</Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((t) => (
          <TabsContent key={t.value} value={t.value} className="min-h-0 flex-1">
            <ScrollArea className="h-full">
              <div className="p-3 pt-1">{t.content}</div>
            </ScrollArea>
          </TabsContent>
        ))}
      </Tabs>
    </aside>
  );
}
