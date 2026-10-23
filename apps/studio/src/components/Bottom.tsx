import { useState } from "react";
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

  return (
    <section className="bottom">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "problems"} onClick={() => onTab("problems")} data-testid="tab-problems">
          {s.problems}
          <span className="counts">
            {count("error") > 0 && <i className="sev-error">{count("error")}</i>}
            {count("warning") > 0 && <i className="sev-warning">{count("warning")}</i>}
            {count("info") > 0 && <i className="sev-info">{count("info")}</i>}
          </span>
        </button>
        <button role="tab" aria-selected={tab === "terraform"} onClick={() => onTab("terraform")} data-testid="tab-terraform">{s.terraform}</button>
        <button role="tab" aria-selected={tab === "resources"} onClick={() => onTab("resources")} data-testid="tab-resources">{s.resources}</button>
      </div>
      <div className="tabbody">
        {tab === "problems" && (
          <ul className="problems" data-testid="problems">
            {analysis.structural.map((p, i) => (
              <li key={`s${i}`} className="sev-error">
                <span className="dot" /> <b>{s.structural}</b> <span>{p.where}: {p.message}</span>
              </li>
            ))}
            {analysis.findings.map((f, i) => (
              <li key={i} className={`sev-${f.severity}`} data-testid={`finding-${f.rule}`}>
                <button type="button" onClick={() => f.targets[0] && selectKey(f.targets[0], f.targets)}>
                  <span className="dot" /> <b>{f.rule}</b> <span>{f.message[lang]}</span>
                  <small>{s.fix}: {f.fix[lang]}</small>
                  <small className="targets">{f.targets.map(nameOf).join(", ")}</small>
                </button>
              </li>
            ))}
            {analysis.structural.length === 0 && analysis.findings.length === 0 && <li className="empty">{s.noProblems}</li>}
          </ul>
        )}
        {tab === "terraform" && (
          files && current ? (
            <div className="tf">
              <div className="tf-files">
                {names.map((n) => <button key={n} type="button" aria-pressed={n === current} onClick={() => setFile(n)}>{n}</button>)}
                <button type="button" className="link" onClick={() => { void navigator.clipboard?.writeText(files[current]!); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? s.copied : s.copy}</button>
              </div>
              <div className="tf-code" data-testid="tf-code">
                {current === "versions.tf" ? (
                  <pre>{files[current]}</pre>
                ) : (
                  analysis.resources.filter((r) => r.file === current).map((r) => (
                    <pre key={r.address} className="tf-res" onClick={() => selectKey(r.from)} title={nameOf(r.from)}>{r.text}</pre>
                  ))
                )}
              </div>
            </div>
          ) : (
            <p className="notice">{s.errorsBlock}</p>
          )
        )}
        {tab === "resources" && (
          files ? (
            <table className="restable" data-testid="resources">
              <thead><tr><th>{s.address}</th><th>{s.file}</th><th>{s.causedBy}</th></tr></thead>
              <tbody>
                {analysis.resources.map((r) => (
                  <tr key={r.address} onClick={() => selectKey(r.from)}>
                    <td><code>{r.address}</code></td><td>{r.file}</td><td>{nameOf(r.from)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="notice">{s.errorsBlock}</p>
          )
        )}
      </div>
    </section>
  );
}
