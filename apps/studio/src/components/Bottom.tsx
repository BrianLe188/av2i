import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Finding } from "@av2i/model";
import type { Analysis } from "../logic/analyze.ts";
import type { Selection } from "../logic/flow.ts";
import type { Lang, Strings } from "../i18n.ts";

export type Tab = "problems" | "terraform" | "resources";

interface Props {
  analysis: Analysis;
  lang: Lang;
  s: Strings;
  tab: Tab;
  onTab: (t: Tab) => void;
  onSelect: (sel: Selection, focus?: string[]) => void;
  nameOf: (key: string) => string;
}

export function Bottom({ analysis, lang, s, tab, onTab, onSelect, nameOf }: Props) {
  const count = (sev: Finding["severity"]) => analysis.findings.filter((f) => f.severity === sev).length + (sev === "error" ? analysis.structural.length : 0);
  const [file, setFile] = useState("network.tf");
  const [copied, setCopied] = useState(false);
  const files = analysis.files;
  const names = files ? Object.keys(files) : [];
  const current = files && file in files ? file : names[0];

  const selectKey = (key: string, focus: string[] = [key]) => {
    const isEdge = !!analysis.normalized?.edges.some((e) => e.id === key) && !analysis.normalized.nodes.some((n) => n.key === key);
    onSelect({ kind: isEdge ? "edge" : "node", id: key }, focus);
  };

  const errorFindings = analysis.findings.filter((f) => f.severity === "error");
  /** Shown above the Terraform and the resources while errors remain: what is written is a preview, and which errors stand in the way. */
  const previewBanner = analysis.errors > 0 && (
    <Alert variant="destructive" className="mb-2" data-testid="preview-banner">
      <AlertDescription>
        <b>{s.previewTitle.replace("{n}", String(analysis.errors))}</b> {analysis.files ? s.previewText : s.cannotWrite.replace("{why}", analysis.generateError ?? "")}
        <ul className="mt-1 grid gap-0.5">
          {errorFindings.slice(0, 5).map((f, i) => (
            <li key={i}>
              <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => f.targets[0] && selectKey(f.targets[0], f.targets)}>
                <b>{f.rule}</b> {f.message[lang]}
              </button>
            </li>
          ))}
          {errorFindings.length > 5 && <li className="text-xs">{s.moreErrors.replace("{n}", String(errorFindings.length - 5))}</li>}
        </ul>
      </AlertDescription>
    </Alert>
  );

  const sev = (v: Finding["severity"]) => (v === "error" ? "bg-destructive text-white" : v === "warning" ? "bg-warning text-white" : "bg-info text-white");
  const dot = (v: Finding["severity"]) => (v === "error" ? "bg-destructive" : v === "warning" ? "bg-warning" : "bg-info");
  return (
    <section className="flex min-h-0 flex-col border-t bg-card" style={{ gridArea: "bot" }}>
      <Tabs value={tab} onValueChange={(v) => onTab(v as Tab)} className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent px-2 pt-1.5">
          <TabsTrigger value="problems" data-testid="tab-problems" className="flex-none gap-1.5">
            {s.problems}
            {(["error", "warning", "info"] as const).map((v) => count(v) > 0 && <Badge key={v} className={`h-[18px] px-1.5 text-[11px] ${sev(v)}`}>{count(v)}</Badge>)}
          </TabsTrigger>
          <TabsTrigger value="terraform" data-testid="tab-terraform" className="flex-none">{s.terraform}</TabsTrigger>
          <TabsTrigger value="resources" data-testid="tab-resources" className="flex-none">{s.resources}</TabsTrigger>
        </TabsList>

        <TabsContent value="problems" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <ul className="px-3 py-1" data-testid="problems">
              {analysis.structural.map((p, i) => (
                <li key={`s${i}`} className="flex items-start gap-2 border-b py-2 text-sm">
                  <span className={`mt-1.5 size-2 flex-none rounded-full ${dot("error")}`} /> <b>{s.structural}</b> <span>{p.where}: {p.message}</span>
                </li>
              ))}
              {analysis.findings.map((f, i) => (
                <li key={i} data-testid={`finding-${f.rule}`} className="border-b">
                  <button type="button" className="flex w-full items-start gap-2 py-2 text-left text-sm hover:bg-accent" onClick={() => f.targets[0] && selectKey(f.targets[0], f.targets)}>
                    <span className={`mt-1.5 size-2 flex-none rounded-full ${dot(f.severity)}`} />
                    <span className="min-w-0 flex-1">
                      <b>{f.rule}</b> <span>{f.message[lang]}</span>
                      <small className="block text-xs text-muted-foreground">{s.fix}: {f.fix[lang]}</small>
                      <small className="block text-xs text-muted-foreground">{f.targets.map(nameOf).join(", ")}</small>
                    </span>
                  </button>
                </li>
              ))}
              {analysis.structural.length === 0 && analysis.findings.length === 0 && <li className="py-2 text-sm text-success">{s.noProblems}</li>}
            </ul>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="terraform" className="min-h-0 flex-1">
          {files && current ? (
            <div className="flex h-full flex-col">
              <div className="flex flex-wrap items-center gap-1 border-b px-3 py-1.5">
                {names.map((n) => <Button key={n} type="button" size="xs" variant={n === current ? "secondary" : "ghost"} aria-pressed={n === current} onClick={() => setFile(n)}>{n}</Button>)}
                <Button type="button" size="xs" variant="ghost" className="ml-auto" onClick={() => { void navigator.clipboard?.writeText(files[current]!); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? <Check /> : <Copy />}{copied ? s.copied : s.copy}</Button>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="px-3 py-2" data-testid="tf-code">
                  {previewBanner}
                  {current.endsWith(".json") || current === "versions.tf" ? (
                    <pre className="font-mono text-xs">{files[current]}</pre>
                  ) : (
                    analysis.resources.filter((r) => r.file === current).map((r) => (
                      <pre key={r.address} className="mb-2 cursor-pointer rounded-md bg-muted p-2 font-mono text-xs hover:ring-1 hover:ring-ring" onClick={() => selectKey(r.from)} title={nameOf(r.from)}>{r.text}</pre>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <div className="p-3">{analysis.errors > 0 ? previewBanner : <Alert><AlertDescription>{s.errorsBlock}</AlertDescription></Alert>}</div>
          )}
        </TabsContent>

        <TabsContent value="resources" className="min-h-0 flex-1">
          {files ? (
            <ScrollArea className="h-full">
              {analysis.errors > 0 && <div className="px-3 pt-2">{previewBanner}</div>}
              <Table data-testid="resources">
                <TableHeader><TableRow><TableHead>{s.address}</TableHead><TableHead>{s.file}</TableHead><TableHead>{s.causedBy}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {analysis.resources.map((r) => (
                    <TableRow key={r.address} className="cursor-pointer" onClick={() => selectKey(r.from)}>
                      <TableCell><code className="text-xs">{r.address}</code></TableCell><TableCell>{r.file}</TableCell><TableCell>{nameOf(r.from)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            <div className="p-3">{analysis.errors > 0 ? previewBanner : <Alert><AlertDescription>{s.errorsBlock}</AlertDescription></Alert>}</div>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}
