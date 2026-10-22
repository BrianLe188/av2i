import { REGIONS } from '@av2i/core';
import { ArrowLeft, Camera, History, LayoutGrid, Redo2, Share2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { SimpleSelect } from './SimpleSelect';
import { ShareDialog } from './ShareDialog';
import { useStore } from '../store';

const SAVE_LABEL = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' } as const;

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

export function ProjectBar() {
  const s = useStore();
  const [sharing, setSharing] = useState(false);

  return (
    <header className="flex shrink-0 items-center gap-2 overflow-x-auto border-b bg-card px-3 py-2">
      <strong className="mr-1 tracking-wide">av2i</strong>
      <Button asChild variant="ghost" size="sm">
        <Link to="/" title="All projects">
          <ArrowLeft /> Projects
        </Link>
      </Button>
      <Input className="h-8 w-44" value={s.name} onChange={(e) => s.setName(e.target.value)} aria-label="Project name" />
      <SimpleSelect
        className="w-40"
        label="Region"
        value={s.region}
        onChange={s.setRegion}
        options={REGIONS.map((r) => ({ value: r, label: r }))}
      />
      <span className="flex-1" />
      <Tip text="Undo (Cmd/Ctrl+Z)">
        <Button variant="outline" size="icon" onClick={s.undo} disabled={s.past.length === 0} aria-label="Undo">
          <Undo2 />
        </Button>
      </Tip>
      <Tip text="Redo (Cmd/Ctrl+Shift+Z)">
        <Button variant="outline" size="icon" onClick={s.redo} disabled={s.future.length === 0} aria-label="Redo">
          <Redo2 />
        </Button>
      </Tip>
      <Tip text="Create a read-only link">
        <Button variant="outline" size="sm" onClick={() => setSharing(true)}>
          <Share2 /> {s.shareToken ? 'Shared' : 'Share'}
        </Button>
      </Tip>
      <Button variant="outline" size="sm" onClick={() => void s.snapshot(window.prompt('Snapshot label (optional)') || undefined)}>
        <Camera /> Snapshot
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Versions">
            <History /> Versions ({s.versions.length})
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-auto">
          <DropdownMenuLabel>Restore a version</DropdownMenuLabel>
          {s.versions.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No snapshots yet.</div>}
          {s.versions.map((v) => (
            <DropdownMenuItem
              key={v.id}
              onSelect={() => {
                if (window.confirm('Restore this version? Current state is kept as a snapshot.')) void s.restore(v.id);
              }}
            >
              {new Date(v.createdAt).toLocaleString()} {v.label ? `· ${v.label}` : ''}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className={cn('min-w-[72px] whitespace-nowrap text-right text-xs text-muted-foreground', s.saveState === 'error' && 'text-destructive')}>
        {s.dirty && s.saveState !== 'saving' ? 'Unsaved…' : SAVE_LABEL[s.saveState]}
      </span>
      <ShareDialog open={sharing} onClose={() => setSharing(false)} />
    </header>
  );
}
