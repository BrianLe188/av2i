import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveQueue, type Failure, type SyncStatus } from "../src/logic/sync.ts";

const tick = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };

describe("SaveQueue", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const make = (over: { save?: (d: string, rev: number) => Promise<{ rev: number }>; classify?: (e: unknown) => Failure } = {}) => {
    const calls: { design: string; rev: number }[] = [];
    const statuses: SyncStatus[] = [];
    const q = new SaveQueue<string>({
      rev: 1, delay: 100,
      save: over.save ?? (async (design, rev) => { calls.push({ design, rev }); return { rev: rev + 1 }; }),
      classify: over.classify ?? (() => "retry"),
      onStatus: (s) => statuses.push(s),
    });
    return { q, calls, statuses };
  };

  it("waits for a quiet moment and saves only the latest design", async () => {
    const { q, calls, statuses } = make();
    q.update("a");
    await tick(60);
    q.update("b");
    await tick(60);
    expect(calls).toEqual([]);
    await tick(60);
    expect(calls).toEqual([{ design: "b", rev: 1 }]);
    expect(statuses).toEqual(["dirty", "dirty", "saving", "saved"]);
  });

  it("bases each save on the revision the previous one returned", async () => {
    const { q, calls } = make();
    q.update("a");
    await tick(150);
    q.update("b");
    await tick(150);
    expect(calls.map((c) => c.rev)).toEqual([1, 2]);
    expect(q.rev).toBe(3);
  });

  it("sends one request at a time and saves what changed meanwhile right after", async () => {
    let release!: () => void;
    const calls: string[] = [];
    let active = 0, most = 0;
    const { q } = make({
      save: (d, rev) => new Promise((res) => {
        calls.push(d);
        active++; most = Math.max(most, active);
        release = () => { active--; res({ rev: rev + 1 }); };
      }),
    });
    q.update("a");
    await tick(150);
    expect(calls).toEqual(["a"]);
    q.update("b");
    await tick(500);
    expect(calls).toEqual(["a"]);
    release();
    await tick(10);
    expect(calls).toEqual(["a", "b"]);
    release();
    await tick(10);
    expect(most).toBe(1);
    expect(q.status).toBe("saved");
  });

  it("stops on a conflict and keeps the design until the person decides", async () => {
    const calls: string[] = [];
    const { q } = make({ save: async (d) => { calls.push(d); throw new Error("rev_conflict"); }, classify: () => "conflict" });
    q.update("mine");
    await tick(150);
    expect(q.status).toBe("conflict");
    q.update("more");
    await tick(1000);
    expect(calls).toEqual(["mine"]);
    q.overwrite(7);
    expect(q.rev).toBe(7);
  });

  it("overwrites from the server's revision when the person chooses to", async () => {
    let fail = true;
    const calls: { d: string; rev: number }[] = [];
    const { q } = make({ save: async (d, rev) => { calls.push({ d, rev }); if (fail) throw new Error("c"); return { rev: rev + 1 }; }, classify: () => "conflict" });
    q.update("mine");
    await tick(150);
    fail = false;
    q.overwrite(9);
    await tick(10);
    expect(calls[calls.length - 1]).toEqual({ d: "mine", rev: 9 });
    expect(q.status).toBe("saved");
  });

  it("retries a hiccup with growing waits and succeeds when the server is back", async () => {
    let up = false;
    const calls: number[] = [];
    const { q } = make({ save: async (_d, rev) => { calls.push(Date.now()); if (!up) throw new Error("down"); return { rev: rev + 1 }; } });
    q.update("a");
    await tick(150);
    expect(q.status).toBe("error");
    await tick(3000);
    expect(calls.length).toBe(2);
    up = true;
    await tick(6000);
    expect(q.status).toBe("saved");
  });

  it("does not retry a refusal that will not pass", async () => {
    const calls: string[] = [];
    const { q } = make({ save: async (d) => { calls.push(d); throw new Error("403"); }, classify: () => "fatal" });
    q.update("a");
    await tick(60_000);
    expect(calls).toEqual(["a"]);
    expect(q.status).toBe("error");
  });

  it("flushes at once, and adopts a design the server sent without saving it back", async () => {
    const { q, calls } = make();
    q.update("a");
    await q.flush();
    expect(calls).toEqual([{ design: "a", rev: 1 }]);
    q.update("b");
    q.adopt(5, "server");
    await tick(1000);
    expect(calls).toHaveLength(1);
    expect(q.rev).toBe(5);
    expect(q.status).toBe("saved");
  });
});
