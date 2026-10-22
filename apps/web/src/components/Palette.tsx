import { RESOURCE_ORDER, RESOURCES, type ResourceType } from '@av2i/core';
import { useStore } from '../store';
import { TYPE_COLORS } from './ResourceNode';

export const DRAG_MIME = 'application/x-av2i-resource';

export function Palette() {
  const addToSelection = useStore((s) => s.addToSelection);

  return (
    <aside className="flex flex-col gap-2 overflow-auto border-r bg-card p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resources</h3>
      <p className="text-xs text-muted-foreground">Drag onto the canvas, or click to add into the selected container.</p>
      {RESOURCE_ORDER.map((type: ResourceType) => {
        const def = RESOURCES[type];
        return (
          <div
            key={type}
            className="flex cursor-grab select-none items-center gap-2 rounded-lg border bg-background px-2.5 py-2 text-sm transition-colors hover:border-primary hover:bg-muted/50 active:cursor-grabbing"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, type);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => addToSelection(type)}
            title={
              def.parents.length
                ? `Must be placed inside: ${def.parents.map((p) => RESOURCES[p].label).join(', ')}`
                : 'Can be placed anywhere'
            }
          >
            <span className="size-3 shrink-0 rounded-[3px]" style={{ background: TYPE_COLORS[type] }} />
            <span className="truncate">{def.label}</span>
            <small className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {def.kind === 'container' ? 'container' : def.parents.length ? 'in ' + def.parents[0] : 'free'}
            </small>
          </div>
        );
      })}
    </aside>
  );
}
