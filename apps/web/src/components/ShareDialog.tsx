import { useState } from 'react';
import { api } from '../api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useStore } from '../store';

export function ShareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projectId = useStore((s) => s.projectId);
  const token = useStore((s) => s.shareToken);
  const setShareToken = useStore((s) => s.setShareToken);
  const notify = useStore((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const url = token ? `${window.location.origin}/s/${token}` : '';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share read-only link</DialogTitle>
          <DialogDescription>
            {token
              ? 'Anyone with this link can view the design, its Terraform and cost. They cannot edit it.'
              : 'Create a private link that lets anyone who has it view this design without signing in.'}
          </DialogDescription>
        </DialogHeader>
        {token && <Input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Share link" />}
        <DialogFooter>
          {token ? (
            <>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.unshareProject(projectId!);
                    setShareToken(null);
                  })
                }
              >
                Stop sharing
              </Button>
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(url);
                  notify('Link copied');
                }}
              >
                Copy link
              </Button>
            </>
          ) : (
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  setShareToken((await api.shareProject(projectId!)).token);
                })
              }
            >
              Create link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
