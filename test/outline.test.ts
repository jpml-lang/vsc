import { describe, expect, test } from "bun:test";

import { toJson } from "../src/json";
import { analyse, type OutlineSymbol } from "../src/outline";

type Tree = [string, Tree[]] | string;

/** Names only, as `name` for leaves and `[name, children]` for parents. */
function tree(symbols: OutlineSymbol[]): Tree[] {
  return symbols.map((s) => (s.children.length ? [s.name, tree(s.children)] : s.name));
}

/** The source text a symbol's range covers. */
function slice(text: string, symbol: OutlineSymbol): string {
  return text.slice(symbol.start, symbol.end);
}

const SAMPLE = `# leading comment
version: 2

[SERVER_ID]
config: {
  disabled_channels:,
  disabled_users: [9892, 82082, 8209]  # trailing
}

[SERVER_ID_2]
prefix: "!"
modules: {moderation: true, fun: false}
`;

describe("outline", () => {
  test("sections, root keys and nested keys", () => {
    expect(tree(analyse(SAMPLE).symbols)).toEqual([
      "version",
      ["SERVER_ID", [["config", ["disabled_channels", "disabled_users"]]]],
      ["SERVER_ID_2", ["prefix", ["modules", ["moderation", "fun"]]]],
    ]);
  });

  test("ranges cover the source they describe", () => {
    const { symbols } = analyse(SAMPLE);
    const [version, server, server2] = symbols as [OutlineSymbol, OutlineSymbol, OutlineSymbol];
    expect(slice(SAMPLE, version)).toBe("version: 2");
    expect(slice(SAMPLE, server)).toBe(
      "[SERVER_ID]\nconfig: {\n  disabled_channels:,\n  disabled_users: [9892, 82082, 8209]  # trailing\n}",
    );
    const config = server.children[0]!;
    expect(slice(SAMPLE, config)).toEndWith("# trailing\n}");
    expect(slice(SAMPLE, config.children[0]!)).toBe("disabled_channels:");
    expect(slice(SAMPLE, config.children[1]!)).toBe("disabled_users: [9892, 82082, 8209]");
    expect(SAMPLE.slice(server.nameStart, server.nameEnd)).toBe("[SERVER_ID]");
    expect(slice(SAMPLE, server2.children[1]!)).toBe("modules: {moderation: true, fun: false}");
  });

  test("comments are found, but not inside strings", () => {
    const text = '# one\na: "not # a comment"  # two\n';
    expect(analyse(text).comments).toEqual([0, text.lastIndexOf("#")]);
  });

  test("a colon inside a value does not start a key", () => {
    expect(tree(analyse("[s]\nurl: http://example.com:8080\nnext: 1\n").symbols)).toEqual([["s", ["url", "next"]]]);
  });

  test("quotes and braces inside an unquoted value are plain text", () => {
    const text = "[s]\na: it's {not} [special]\nb: 1\n";
    expect(tree(analyse(text).symbols)).toEqual([["s", ["a", "b"]]]);
  });

  test("quoted keys and headers", () => {
    const text = '["weird.name"]\n"needs quotes": 1\n\'single\': 2\n"": 3\n';
    expect(tree(analyse(text).symbols)).toEqual([['"weird.name"', ["needs quotes", "single", ""]]]);
  });

  test("a '[' inside a multi-line array is not a header", () => {
    const text = "[s]\nids: [\n[1, 2],\n  3\n]\nafter: 1\n";
    expect(tree(analyse(text).symbols)).toEqual([["s", ["ids", "after"]]]);
  });

  test("objects inside arrays have no named parent", () => {
    const text = "[s]\nlist: [{a: 1}, {b: 2}]\nnext: 1\n";
    expect(tree(analyse(text).symbols)).toEqual([["s", ["list", "next"]]]);
  });

  test("backslash-newline continues a string", () => {
    const text = '[s]\na: "one \\\n  two: not a key"\nb: 1\n';
    expect(tree(analyse(text).symbols)).toEqual([["s", ["a", "b"]]]);
  });

  test("half-typed documents never throw", () => {
    for (const text of ["[", "[s", "a:", "a: {", "a: {b: [1, {", '"unterminated', "a: 'x", "}}]]", "[s]\nk: {\n  x: 1\n"]) {
      expect(() => analyse(text)).not.toThrow();
    }
    const { symbols } = analyse("[s]\nk: {\n  x: 1\n");
    expect(tree(symbols)).toEqual([["s", [["k", ["x"]]]]]);
    expect(symbols[0]!.end).toBe("[s]\nk: {\n  x: 1".length);
  });

  test("CRLF line endings", () => {
    const text = "[a]\r\nx: 1\r\n\r\n[b]\r\ny: 2\r\n";
    const { symbols } = analyse(text);
    expect(tree(symbols)).toEqual([["a", ["x"]], ["b", ["y"]]]);
    expect(slice(text, symbols[0]!)).toBe("[a]\r\nx: 1");
  });
});

describe("toJson", () => {
  test("keeps bigints and non-finite numbers", () => {
    expect(toJson({ id: 111111111111111111n, n: [NaN, -Infinity], e: {} })).toBe(
      '{\n  "id": 111111111111111111,\n  "n": [\n    NaN,\n    -Infinity\n  ],\n  "e": {}\n}',
    );
  });
});
