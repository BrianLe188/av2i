export type SyncStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

export type Failure = "conflict" | "retry" | "fatal";

export interface SyncOptions<D> {
  /** the revision of the project as loaded */
  rev: number;
  /** wait this long after the last change before saving */
  delay?: number;
  save: (design: D, baseRev: number) => Promise<{ rev: number }>;
  /** what a failed save means: someone else saved first, a hiccup worth retrying, or a refusal that will not pass */
  classify: (error: unknown) => Failure;
  onStatus: (status: SyncStatus, error?: unknown) => void;
}

const RETRY_MS = [3000, 6000, 12000];

/**
 * Saves the latest design a little after the last change, one request at a time, each based on the revision the previous one returned.
 * Changes made while a save is in flight go out in the next one. A conflict stops it until the person decides what to do.
 */
export class SaveQueue<D> {
  private latest: D | undefined;
  private baseRev: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private dirty = false;
  private failures = 0;
  private stopped = false;
  private opts: SyncOptions<D>;
  status: SyncStatus = "saved";

  constructor(opts: SyncOptions<D>) {
    this.opts = opts;
    this.baseRev = opts.rev;
  }

  get rev(): number { return this.baseRev; }

  private set(status: SyncStatus, error?: unknown): void {
    this.status = status;
    this.opts.onStatus(status, error);
  }

  /** A new design to keep: it will be saved after the delay. */
  update(design: D): void {
    this.latest = design;
    this.dirty = true;
    if (this.stopped) return;
    if (this.status !== "saving") this.set("dirty");
    this.schedule(this.opts.delay ?? 1200);
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), ms);
  }

  private async run(): Promise<void> {
    if (this.stopped || !this.dirty) return;
    if (this.inFlight) return void this.inFlight.then(() => this.run());
    clearTimeout(this.timer);
    const design = this.latest as D;
    this.dirty = false;
    this.set("saving");
    this.inFlight = (async () => {
      try {
        const r = await this.opts.save(design, this.baseRev);
        this.baseRev = r.rev;
        this.failures = 0;
        if (this.dirty) this.schedule(0);
        else this.set("saved");
      } catch (e) {
        this.dirty = true;
        const kind = this.opts.classify(e);
        if (kind === "conflict") { this.stopped = true; this.set("conflict", e); }
        else if (kind === "fatal") { this.stopped = true; this.set("error", e); }
        else {
          this.set("error", e);
          this.schedule(RETRY_MS[Math.min(this.failures++, RETRY_MS.length - 1)]!);
        }
      } finally {
        this.inFlight = undefined;
      }
    })();
    await this.inFlight;
  }

  /** Save now and resolve when nothing is left to save (or it cannot be saved). */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    for (let i = 0; i < 50 && !this.stopped && (this.dirty || this.inFlight); i++) {
      if (this.inFlight) await this.inFlight;
      else await this.run();
      if (this.status === "error") return;
    }
  }

  /** The person chose to overwrite: keep going from the revision the server has now. */
  overwrite(currentRev: number): void {
    this.baseRev = currentRev;
    this.stopped = false;
    this.failures = 0;
    this.schedule(0);
  }

  /** The design was replaced by what the server has (a reload or a restore): nothing is pending any more. */
  adopt(rev: number, design: D): void {
    clearTimeout(this.timer);
    this.baseRev = rev;
    this.latest = design;
    this.dirty = false;
    this.stopped = false;
    this.failures = 0;
    this.set("saved");
  }

  /** Try again now after an error. */
  retry(): void {
    this.stopped = false;
    this.schedule(0);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.stopped = true;
  }
}
