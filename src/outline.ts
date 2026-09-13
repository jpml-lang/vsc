/**
 * A forgiving structural scan of a `.jp` document, used for the outline,
 * breadcrumbs, folding and comment detection.
 *
 * Unlike the real parser it never throws: a half-typed document still yields
 * as much structure as can be recovered, which is what an editor needs while
 * someone is typing. It follows the parser's lexical rules closely enough that
 * the two agree on every valid document.
 *
 * Kept free of `vscode` imports so it can be unit tested directly.
 */

export type OutlineKind = "section" | "key";

export interface OutlineSymbol {
  /** Header text (`guild.limits`) or key name. May be empty for `"": 1`. */
  name: string;
  kind: OutlineKind;
  /** Offset where the symbol starts: the `[` of a header, or the key. */
  start: number;
  /** Offset just past the symbol's last non-whitespace character. */
  end: number;
  /** Offsets of the header or key text itself. */
  nameStart: number;
  nameEnd: number;
  children: OutlineSymbol[];
}

export interface Analysis {
  symbols: OutlineSymbol[];
  /** Offsets of every `#` that starts a comment. */
  comments: number[];
}

interface Frame {
  type: "root" | "object" | "array";
  /** The key whose value this container is, if any. */
  owner: OutlineSymbol | null;
  /** The entry in this frame whose value is still being read. */
  open: OutlineSymbol | null;
  /** Objects and the root: the next token may be a key. */
  expectKey: boolean;
  /** Arrays: the next token starts a value. */
  expectValue: boolean;
}

const BARE_KEY = /[^\s:,{}[\]"'#][^:,{}[\]"'#\r\n]*/y;

export function analyse(text: string): Analysis {
  const symbols: OutlineSymbol[] = [];
  const comments: number[] = [];
  const root: Frame = { type: "root", owner: null, open: null, expectKey: true, expectValue: false };
  const stack: Frame[] = [root];
  let section: OutlineSymbol | null = null;
  /** A key whose `:` has been read but whose value has not started yet. */
  let pending: OutlineSymbol | null = null;
  let lineStart = true;

  const extend = (symbol: OutlineSymbol, pos: number) => {
    symbol.end = Math.max(symbol.end, trimEnd(text, symbol.start, pos));
  };
  const close = (frame: Frame, pos: number) => {
    if (frame.open) extend(frame.open, pos);
    frame.open = null;
  };
  /** A line break or comma ends the current entry (or array element). */
  const separate = (frame: Frame, pos: number) => {
    if (frame.type === "array") {
      frame.expectValue = true;
    } else {
      close(frame, pos);
      frame.expectKey = true;
    }
    pending = null;
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i]!;
    const frame = stack[stack.length - 1]!;

    if (char === "\n") {
      separate(frame, i);
      lineStart = true;
      i++;
      continue;
    }
    if (char === " " || char === "\t" || char === "\r" || char === "\f" || char === "\v" || char === "﻿") {
      i++;
      continue;
    }
    if (char === "#") {
      comments.push(i);
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }

    const atLineStart = lineStart;
    lineStart = false;

    // A '[' opens a section header only at the start of a top-level line.
    if (char === "[" && frame === root && atLineStart) {
      close(root, i);
      if (section) extend(section, i);
      const header = scanHeader(text, i);
      section = {
        name: header.name,
        kind: "section",
        start: i,
        end: header.end,
        nameStart: i,
        nameEnd: header.end,
        children: [],
      };
      symbols.push(section);
      root.expectKey = false;
      pending = null;
      i = header.end;
      continue;
    }

    if (char === "}" || char === "]") {
      if (stack.length > 1) {
        const popped = stack.pop()!;
        close(popped, i);
        if (popped.owner) {
          popped.owner.end = i + 1;
          const parent = stack[stack.length - 1]!;
          if (parent.open === popped.owner) parent.open = null;
        }
      }
      pending = null;
      i++;
      continue;
    }

    if (char === ",") {
      separate(frame, i);
      i++;
      continue;
    }

    if (frame.expectKey) {
      frame.expectKey = false;
      const key = scanKey(text, i);
      if (key) {
        const symbol: OutlineSymbol = {
          name: key.name,
          kind: "key",
          start: i,
          end: key.after,
          nameStart: i,
          nameEnd: key.nameEnd,
          children: [],
        };
        // Keys inside an object that is itself an array element have no
        // named parent, so they are left out of the outline.
        const siblings = frame === root ? (section?.children ?? symbols) : frame.owner?.children;
        siblings?.push(symbol);
        frame.open = symbol;
        pending = symbol;
        i = key.after;
        continue;
      }
    }

    // Anything else is part of a value. Only its first character decides
    // whether it is a container or a quoted string, exactly as in the parser:
    // `a: it's` and `a: x{y` are plain unquoted strings.
    const owner = pending;
    const startsValue = owner !== null || frame.expectValue;
    pending = null;
    frame.expectValue = false;

    if (startsValue && (char === "{" || char === "[")) {
      const isObject = char === "{";
      stack.push({ type: isObject ? "object" : "array", owner, open: null, expectKey: isObject, expectValue: !isObject });
      i++;
    } else if (startsValue && (char === '"' || char === "'")) {
      i = skipString(text, i);
    } else {
      i++;
    }
  }

  for (const frame of stack) {
    close(frame, text.length);
    if (frame.owner) extend(frame.owner, text.length);
  }
  if (section) extend(section, text.length);
  return { symbols, comments };
}

/** Skip a quoted string at `i`; stops at an unescaped line break if unterminated. */
function skipString(text: string, i: number): number {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    const char = text[j];
    if (char === quote) return j + 1;
    if (char === "\\") {
      // Skips the escaped character, including a backslash-newline continuation.
      j += text[j + 1] === "\r" && text[j + 2] === "\n" ? 3 : 2;
      continue;
    }
    if (char === "\n" || char === "\r") return j;
    j++;
  }
  return j;
}

/** Read `[a.b]` at `i`; tolerates a missing `]`. */
function scanHeader(text: string, i: number): { name: string; end: number } {
  let j = i + 1;
  while (j < text.length && text[j] !== "\n" && text[j] !== "\r" && text[j] !== "#") {
    const char = text[j];
    if (char === '"' || char === "'") {
      j = skipString(text, j);
    } else if (char === "]") {
      return { name: text.slice(i + 1, j).trim(), end: j + 1 };
    } else {
      j++;
    }
  }
  const end = Math.max(i + 1, trimEnd(text, i, j));
  return { name: text.slice(i + 1, end).trim(), end };
}

/** Read `key:` at `i`, returning `null` if there is no colon after the key. */
function scanKey(text: string, i: number): { name: string; nameEnd: number; after: number } | null {
  let name: string;
  let nameEnd: number;
  const char = text[i];
  if (char === '"' || char === "'") {
    nameEnd = skipString(text, i);
    if (text[nameEnd - 1] !== char || nameEnd === i + 1) return null;
    name = text.slice(i + 1, nameEnd - 1);
  } else {
    BARE_KEY.lastIndex = i;
    const match = BARE_KEY.exec(text);
    if (!match) return null;
    name = match[0].trimEnd();
    nameEnd = i + name.length;
  }
  let j = nameEnd;
  while (text[j] === " " || text[j] === "\t") j++;
  return text[j] === ":" ? { name, nameEnd, after: j + 1 } : null;
}

function trimEnd(text: string, start: number, pos: number): number {
  let end = pos;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return end;
}
