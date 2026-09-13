import * as vscode from "vscode";
import { JPDecodeError, dumps, loads, type DuplicateKeys } from "jpml-lang/core";

import { toJson } from "./json";
import { analyse, type OutlineSymbol } from "./outline";

const LANGUAGE = "jpml";
const SELECTOR: vscode.DocumentSelector = { language: LANGUAGE };

/** How long to wait after the last keystroke before re-checking a document. */
const VALIDATE_DELAY_MS = 250;

/** The token an error points at: a run of value/key characters, or one punctuation mark. */
const ERROR_TOKEN = /[^\s,{}[\]:#]+|[,{}[\]:#]/;

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection(LANGUAGE);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const validate = (document: vscode.TextDocument) => {
    if (document.languageId !== LANGUAGE) return;
    const enabled = settings(document).get("validate.enable", true);
    diagnostics.set(document.uri, enabled ? check(document) : []);
  };

  const cancel = (document: vscode.TextDocument) => {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.delete(key);
  };

  const schedule = (document: vscode.TextDocument) => {
    if (document.languageId !== LANGUAGE) return;
    cancel(document);
    const key = document.uri.toString();
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        validate(document);
      }, VALIDATE_DELAY_MS),
    );
  };

  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidOpenTextDocument(validate),
    vscode.workspace.onDidSaveTextDocument(validate),
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      cancel(document);
      diagnostics.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("jpml")) vscode.workspace.textDocuments.forEach(validate);
    }),
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, { provideDocumentSymbols }),
    vscode.languages.registerFoldingRangeProvider(SELECTOR, { provideFoldingRanges }),
    vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, { provideDocumentFormattingEdits }),
    vscode.commands.registerCommand("jpml.showJson", showJson),
    { dispose: () => timers.forEach((timer) => clearTimeout(timer)) },
  );

  vscode.workspace.textDocuments.forEach(validate);
}

export function deactivate(): void {}

function settings(document?: vscode.TextDocument): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("jpml", document);
}

function parse(document: vscode.TextDocument) {
  return loads(document.getText(), {
    duplicateKeys: settings(document).get<DuplicateKeys>("duplicateKeys", "error"),
  });
}

// -- diagnostics ---------------------------------------------------------------

function check(document: vscode.TextDocument): vscode.Diagnostic[] {
  try {
    parse(document);
    return [];
  } catch (error) {
    if (!(error instanceof JPDecodeError)) throw error;
    const start = document.positionAt(error.pos);
    const range = document.getWordRangeAtPosition(start, ERROR_TOKEN) ?? new vscode.Range(start, start);
    const diagnostic = new vscode.Diagnostic(range, error.rawMessage, vscode.DiagnosticSeverity.Error);
    diagnostic.source = "jpml";
    return [diagnostic];
  }
}

// -- outline and folding --------------------------------------------------------

function provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const convert = (symbol: OutlineSymbol): vscode.DocumentSymbol => {
    const kind =
      symbol.kind === "section"
        ? vscode.SymbolKind.Namespace
        : symbol.children.length
          ? vscode.SymbolKind.Object
          : vscode.SymbolKind.Property;
    const result = new vscode.DocumentSymbol(
      symbol.name || '""', // VS Code rejects empty names; `"": 1` is a legal key.
      "",
      kind,
      new vscode.Range(document.positionAt(symbol.start), document.positionAt(symbol.end)),
      new vscode.Range(document.positionAt(symbol.nameStart), document.positionAt(symbol.nameEnd)),
    );
    result.children = symbol.children.map(convert);
    return result;
  };
  return analyse(document.getText()).symbols.map(convert);
}

function provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
  const text = document.getText();
  const { symbols, comments } = analyse(text);
  const ranges: vscode.FoldingRange[] = [];
  const visit = (symbol: OutlineSymbol) => {
    const startLine = document.positionAt(symbol.start).line;
    let endLine = document.positionAt(symbol.end).line;
    // Keep a closing bracket on its own line visible, like brace folding elsewhere.
    const last = text[symbol.end - 1];
    if (symbol.kind === "key" && (last === "}" || last === "]") && endLine > startLine) {
      const lineText = document.lineAt(endLine).text;
      if (lineText.trim() === last || lineText.trim().startsWith(last)) endLine--;
    }
    if (endLine > startLine) ranges.push(new vscode.FoldingRange(startLine, endLine));
    symbol.children.forEach(visit);
  };
  symbols.forEach(visit);

  // Consecutive comment lines fold together too.
  let runStart = -1;
  let previous = -2;
  for (const offset of comments) {
    const position = document.positionAt(offset);
    if (document.lineAt(position.line).firstNonWhitespaceCharacterIndex !== position.character) continue;
    if (position.line !== previous + 1) {
      if (previous > runStart && runStart >= 0) ranges.push(new vscode.FoldingRange(runStart, previous, vscode.FoldingRangeKind.Comment));
      runStart = position.line;
    }
    previous = position.line;
  }
  if (previous > runStart && runStart >= 0) ranges.push(new vscode.FoldingRange(runStart, previous, vscode.FoldingRangeKind.Comment));

  return ranges;
}

// -- formatting -----------------------------------------------------------------

function provideDocumentFormattingEdits(
  document: vscode.TextDocument,
  options: vscode.FormattingOptions,
): vscode.TextEdit[] {
  const text = document.getText();
  let data;
  try {
    data = parse(document);
  } catch (error) {
    if (error instanceof JPDecodeError) return []; // the diagnostic already explains why
    throw error;
  }

  const config = settings(document);
  if (analyse(text).comments.length && !config.get("format.allowDroppingComments", false)) {
    void vscode.window
      .showWarningMessage(
        "JPML: this file was not formatted because formatting would remove its comments.",
        "Change Setting",
      )
      .then((choice) => {
        if (choice) {
          void vscode.commands.executeCommand("workbench.action.openSettings", "jpml.format.allowDroppingComments");
        }
      });
    return [];
  }

  const formatted = dumps(data, {
    indent: options.tabSize,
    width: config.get("format.width", 88),
    sortKeys: config.get("format.sortKeys", false),
  });
  if (formatted === text) return [];
  const everything = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
  return [vscode.TextEdit.replace(everything, formatted)];
}

// -- commands -------------------------------------------------------------------

async function showJson(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== LANGUAGE) {
    void vscode.window.showInformationMessage("Open a .jp file to preview it as JSON.");
    return;
  }
  let data;
  try {
    data = parse(editor.document);
  } catch (error) {
    if (!(error instanceof JPDecodeError)) throw error;
    void vscode.window.showErrorMessage(
      `JPML: cannot preview, line ${error.line}, column ${error.col}: ${error.rawMessage}`,
    );
    return;
  }
  const preview = await vscode.workspace.openTextDocument({ language: "json", content: `${toJson(data)}\n` });
  await vscode.window.showTextDocument(preview, { viewColumn: vscode.ViewColumn.Beside, preview: true });
}
