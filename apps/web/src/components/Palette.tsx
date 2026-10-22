import { RESOURCE_ORDER, RESOURCES, type ResourceType } from '@av2i/core';
import { useStore } from '../store';
import { TYPE_COLORS } from './ResourceNode';

export const DRAG_MIME = 'application/x-av2i-resource';

export function Palette() {
  const addToSelection = useStore((s) => s.addToSelection);

  return (
    <aside className="palette">
      <h3>Resources</h3>
      <p className="muted">Drag onto the canvas, or click to add into the selected container.</p>
      {RESOURCE_ORDER.map((type: ResourceType) => {
        const def = RESOURCES[type];
        return (
          <div
            key={type}
            className="palette-item"
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
            <span className="swatch" style={{ background: TYPE_COLORS[type] }} />
            <span>{def.label}</span>
            <small>{def.kind === 'container' ? 'container' : def.parents.length ? 'in ' + def.parents[0] : 'free'}</small>
          </div>
        );
      })}
    </aside>
  );
}
