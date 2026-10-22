/**
 * A small, tolerant HCL reader: enough to pull resources, data sources, attributes and nested blocks
 * out of ordinary Terraform files. It does not evaluate anything (no variables, modules, count or for_each).
 */
export type Expr =
  | { kind: 'string'; value: string; raw: string; interpolated: boolean }
  | { kind: 'number'; value: number; raw: string }
  | { kind: 'bool'; value: boolean; raw: string }
  | { kind: 'ref'; raw: string }
  | { kind: 'list'; items: Expr[]; raw: string }
  | { kind: 'object'; entries: Record<string, Expr>; raw: string }
  | { kind: 'raw'; raw: string };

export interface Block {
  type: string;
  labels: string[];
  attrs: Record<string, Expr>;
  blocks: Block[];
}

class Reader {
  pos = 0;
  constructor(readonly src: string) {}

  eof() {
    return this.pos >= this.src.length;
  }
  peek(n = 0) {
    return this.src[this.pos + n];
  }

  /** Skip whitespace and comments. */
  skip(newlines = true) {
    for (;;) {
      const c = this.peek();
      if (c === ' ' || c === '\t' || c === '\r' || (newlines && c === '\n')) this.pos++;
      else if (c === '#' || (c === '/' && this.peek(1) === '/')) {
        while (!this.eof() && this.peek() !== '\n') this.pos++;
      } else if (c === '/' && this.peek(1) === '*') {
        const end = this.src.indexOf('*/', this.pos + 2);
        this.pos = end < 0 ? this.src.length : end + 2;
      } else return;
    }
  }

  ident(): string | null {
    const m = /^[A-Za-z_][\w-]*/.exec(this.src.slice(this.pos, this.pos + 128));
    if (!m) return null;
    this.pos += m[0].length;
    return m[0];
  }

  /** Reads a quoted string; `interpolated` is true when it contains `${...}`. */
  string(): { value: string; interpolated: boolean } {
    this.pos++; // opening quote
    let value = '';
    let interpolated = false;
    while (!this.eof() && this.peek() !== '"') {
      const c = this.peek();
      if (c === '\\') {
        const n = this.peek(1);
        value += n === 'n' ? '\n' : n === 't' ? '\t' : n;
        this.pos += 2;
      } else if (c === '$' && this.peek(1) === '{') {
        interpolated = true;
        let depth = 0;
        const start = this.pos;
        do {
          if (this.peek() === '{') depth++;
          if (this.peek() === '}') depth--;
          this.pos++;
        } while (depth > 0 && !this.eof());
        value += this.src.slice(start, this.pos);
      } else {
        value += c;
        this.pos++;
      }
    }
    this.pos++; // closing quote
    return { value, interpolated };
  }

  /** Skips a balanced (...), [...] or {...} group, honouring strings. */
  balanced(open: string, close: string) {
    let depth = 0;
    do {
      const c = this.peek();
      if (c === '"') this.string();
      else {
        if (c === open) depth++;
        if (c === close) depth--;
        this.pos++;
      }
    } while (depth > 0 && !this.eof());
  }

  expr(): Expr {
    this.skip();
    const start = this.pos;
    const c = this.peek();
    const raw = () => this.src.slice(start, this.pos).trim();

    if (c === '"') {
      const { value, interpolated } = this.string();
      return this.tail({ kind: 'string', value, interpolated, raw: raw() }, start);
    }
    if (c === '[') {
      this.pos++;
      const items: Expr[] = [];
      for (;;) {
        this.skip();
        if (this.peek() === ']' || this.eof()) break;
        items.push(this.expr());
        this.skip();
        if (this.peek() === ',') this.pos++;
      }
      this.pos++;
      return this.tail({ kind: 'list', items, raw: raw() }, start);
    }
    if (c === '{') {
      this.pos++;
      const entries: Record<string, Expr> = {};
      for (;;) {
        this.skip();
        if (this.peek() === '}' || this.eof()) break;
        let key: string;
        if (this.peek() === '"') key = this.string().value;
        else key = this.ident() ?? this.src[this.pos++];
        this.skip();
        if (this.peek() === '=' || this.peek() === ':') {
          this.pos++;
          entries[key] = this.expr();
        }
        this.skip();
        if (this.peek() === ',') this.pos++;
      }
      this.pos++;
      return { kind: 'object', entries, raw: raw() };
    }
    if (c === '<' && this.peek(1) === '<') {
      const m = /^<<-?\s*(\w+)\n/.exec(this.src.slice(this.pos));
      if (m) {
        const end = this.src.indexOf(`\n${m[1]}`, this.pos + m[0].length);
        this.pos = end < 0 ? this.src.length : end + 1 + m[1].length;
        return { kind: 'raw', raw: raw() };
      }
    }
    const num = /^-?\d+(\.\d+)?/.exec(this.src.slice(this.pos, this.pos + 32));
    if (num) {
      this.pos += num[0].length;
      return { kind: 'number', value: Number(num[0]), raw: num[0] };
    }
    const word = /^[A-Za-z_][\w-]*/.exec(this.src.slice(this.pos, this.pos + 128));
    if (word) {
      if (word[0] === 'true' || word[0] === 'false') {
        this.pos += word[0].length;
        return { kind: 'bool', value: word[0] === 'true', raw: word[0] };
      }
      // reference path (a.b[0].c) or function call (name(...))
      for (;;) {
        const p = this.peek();
        if (p && /[\w.-]/.test(p)) this.pos++;
        else if (p === '[') this.balanced('[', ']');
        else break;
      }
      if (this.peek() === '(') {
        this.balanced('(', ')');
        return this.tail({ kind: 'raw', raw: raw() }, start);
      }
      return this.tail({ kind: 'ref', raw: raw() }, start);
    }
    // anything else (operators, for-expressions...): consume to end of the line
    while (!this.eof() && this.peek() !== '\n') {
      if (this.peek() === '(' || this.peek() === '[' || this.peek() === '{') this.balanced(this.peek()!, { '(': ')', '[': ']', '{': '}' }[this.peek()!]!);
      else this.pos++;
    }
    return { kind: 'raw', raw: raw() };
  }

  /** A value followed by an operator (`a ? b : c`, `x + y`) is no longer a plain literal. */
  tail(expr: Expr, start: number): Expr {
    const save = this.pos;
    this.skip(false);
    const c = this.peek();
    if (c && c !== '\n' && c !== ',' && c !== ']' && c !== '}' && c !== ')' && c !== undefined && c !== '#') {
      while (!this.eof() && this.peek() !== '\n' && this.peek() !== ',' && this.peek() !== '}' && this.peek() !== ']') {
        if (this.peek() === '(' || this.peek() === '[') this.balanced(this.peek()!, this.peek() === '(' ? ')' : ']');
        else if (this.peek() === '"') this.string();
        else this.pos++;
      }
      return { kind: 'raw', raw: this.src.slice(start, this.pos).trim() };
    }
    this.pos = save;
    return expr;
  }

  body(): { attrs: Record<string, Expr>; blocks: Block[] } {
    const attrs: Record<string, Expr> = {};
    const blocks: Block[] = [];
    for (;;) {
      this.skip();
      if (this.eof() || this.peek() === '}') return { attrs, blocks };
      const name = this.peek() === '"' ? this.string().value : this.ident();
      if (!name) {
        this.pos++;
        continue;
      }
      this.skip(false);
      if (this.peek() === '=') {
        this.pos++;
        attrs[name] = this.expr();
      } else {
        const labels: string[] = [];
        for (;;) {
          this.skip(false);
          if (this.peek() === '"') labels.push(this.string().value);
          else {
            const l = /^[A-Za-z_][\w-]*/.exec(this.src.slice(this.pos, this.pos + 64));
            if (!l || this.peek() === '{') break;
            this.pos += l[0].length;
            labels.push(l[0]);
          }
        }
        if (this.peek() === '{') {
          this.pos++;
          const inner = this.body();
          if (this.peek() === '}') this.pos++;
          blocks.push({ type: name, labels, ...inner });
        }
      }
    }
  }
}

export function parseHcl(text: string): Block[] {
  const reader = new Reader(text);
  const top = reader.body();
  return top.blocks;
}

// --- Small helpers for reading parsed values ---------------------------------

export const asString = (e: Expr | undefined): string | undefined =>
  e?.kind === 'string' && !e.interpolated ? e.value : undefined;
export const asNumber = (e: Expr | undefined): number | undefined =>
  e?.kind === 'number' ? e.value : e?.kind === 'string' && /^\d+$/.test(e.value) ? Number(e.value) : undefined;
export const asBool = (e: Expr | undefined): boolean | undefined => (e?.kind === 'bool' ? e.value : undefined);

/** `aws_subnet.public.id` -> `{ type: 'aws_subnet', name: 'public' }`; data sources are `data.<type>.<name>`. */
export function refOf(e: Expr | undefined): { type: string; name: string } | undefined {
  if (!e || (e.kind !== 'ref' && e.kind !== 'raw' && e.kind !== 'string')) return undefined;
  const text = e.kind === 'string' ? e.value : e.raw;
  const m = /(?:^|[^\w.])(?:\$\{)?(data\.)?([a-z][a-z0-9]*_[\w]*)\.([\w-]+)/.exec(text);
  return m ? { type: m[2], name: m[3] } : undefined;
}

export const refsIn = (text: string): { type: string; name: string }[] =>
  [...text.matchAll(/(?<![\w.])(aws_[a-z0-9_]+)\.([\w-]+)/g)].map((m) => ({ type: m[1], name: m[2] }));
