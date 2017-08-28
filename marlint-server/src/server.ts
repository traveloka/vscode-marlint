import * as path from "path";
import {
  createConnection,
  IConnection,
  Diagnostic,
  DiagnosticSeverity,
  Files,
  TextDocuments,
  TextDocument,
  IPCMessageReader,
  IPCMessageWriter,
  InitializeParams,
  InitializeResult
} from "vscode-languageserver";
import Uri from "vscode-uri";

interface ESLintAutoFixEdit {
  range: [number, number];
  text: string;
}

interface ESLintProblem {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: number;
  ruleId: string;
  message: string;
  fix?: ESLintAutoFixEdit;
}

interface ESLintDocumentReport {
  filePath: string;
  errorCount: number;
  warningCount: number;
  messages: ESLintProblem[];
  output?: string;
}

interface ESLintReport {
  errorCount: number;
  warningCount: number;
  results: ESLintDocumentReport[];
}

interface MarlintOptions {
  [key: string]: any;
}

interface MarlintModule {
  lintText(code: string, options: MarlintOptions): ESLintReport;
}

interface Settings {
  languageServerExample: MarlintSettings;
}

interface MarlintSettings {
  showWarning: boolean;
}

let showWarning: boolean;

let nodePath: string;
let globalNodePath: string;
let workspaceRoot: string;

interface Path2Library {
  [path: string]: MarlintModule;
}

interface Document2Library {
  [path: string]: Thenable<MarlintModule>;
}

let path2Library: Path2Library = Object.create(null);
let document2Library: Document2Library = Object.create(null);

// Create a connection for the server. The connection uses Node's IPC as a transport
let connection: IConnection = createConnection(
  new IPCMessageReader(process),
  new IPCMessageWriter(process)
);

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);
documents.onDidOpen(event => {
  let docUri = event.document.uri;

  if (!document2Library[docUri]) {
    let uri = Uri.parse(docUri);
    let promise: Thenable<string>;

    if (uri.scheme === "file") {
      let file = uri.fsPath;
      let directory = path.dirname(file);
      if (nodePath) {
        promise = Files.resolve("marlint", nodePath, nodePath, trace).then<
          string,
          string
        >(undefined, () => {
          return Files.resolve("marlint", globalNodePath, directory, trace);
        });
      } else {
        promise = Files.resolve("marlint", globalNodePath, directory, trace);
      }
    } else {
      promise = Files.resolve("marlint", globalNodePath, workspaceRoot, trace);
    }

    document2Library[docUri] = promise.then(
      path => {
        let library = path2Library[path];

        if (!library) {
          library = require(path);
          if (!library.lintText) {
            throw new Error("The marlint library doesn't export lintText");
          }
          connection.console.info(`Marlint loaded from ${path}`);
          path2Library[path] = library;
        }

        return library;
      },
      () => {
        return null;
      }
    );

    setImmediate(() => validateDocument(event.document));
  }
});

// A text document has been saved. Validate the document according the run setting.
documents.onDidSave(event => {
  // We even validate onSave if we have validated on will save to compute fixes since the
  // fixes will change the content of the document.
  setImmediate(() => validateDocument(event.document));
});

// The settings have changed. Is send on server activation
// as well.
connection.onDidChangeConfiguration(change => {
  let settings = <Settings>change.settings;
  showWarning = settings.languageServerExample.showWarning || false;
  // Revalidate any open text documents
  documents.all().forEach(validateDocument);
});

documents.onDidClose(event => {
  connection.sendDiagnostics({
    uri: event.document.uri,
    diagnostics: []
  });
});

function validate(document: TextDocument, marlint: MarlintModule) {
  const content = document.getText();
  const uri = document.uri;
  const file = getFilePath(document);
  const cwd = process.cwd();
  const options = {
    cwd,
    filename: file
  };

  const report = marlint.lintText(content, options);

  const diagnostics: Diagnostic[] = report.results[0].messages.map(
    (problem: any) => {
      const message =
        problem.ruleId != null
          ? `${problem.message} (${problem.ruleId})`
          : `${problem.message}`;

      return {
        message,
        severity:
          problem.severity === 2
            ? DiagnosticSeverity.Error
            : DiagnosticSeverity.Warning,
        code: problem.ruleId,
        source: "Marlint",
        range: {
          start: { line: problem.line - 1, character: problem.column - 1 },
          end: { line: problem.line - 1, character: problem.column - 1 }
        }
      };
    }
  );

  connection.sendDiagnostics({ uri, diagnostics });
}

function validateDocument(document: TextDocument): Thenable<void> {
  // We validate document in a queue but open / close documents directly. So we need to deal with the
  // fact that a document might be gone from the server.
  if (!documents.get(document.uri) || !document2Library[document.uri]) {
    return Promise.resolve(undefined);
  }

  return document2Library[document.uri].then((library: MarlintModule) => {
    if (!library) {
      return;
    }

    try {
      validate(document, library);
    } catch (err) {}
  });
}

function trace(message: string, verbose?: string): void {
  connection.tracer.log(message, verbose);
}

namespace Is {
  const toString = Object.prototype.toString;

  export function boolean(value: any): value is boolean {
    return value === true || value === false;
  }

  export function string(value: any): value is string {
    return toString.call(value) === "[object String]";
  }
}

function getFilePath(documentOrUri: string | TextDocument): string {
  if (!documentOrUri) {
    return undefined;
  }
  let uri = Is.string(documentOrUri)
    ? Uri.parse(documentOrUri)
    : Uri.parse(documentOrUri.uri);
  if (uri.scheme !== "file") {
    return undefined;
  }
  return uri.fsPath;
}

// After the server has started the client sends an initialize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilities.
connection.onInitialize((params: InitializeParams): InitializeResult => {
  let initOptions: {
    legacyModuleResolve: boolean;
    nodePath: string;
  } =
    params.initializationOptions || {};

  workspaceRoot = params.rootPath;
  nodePath = initOptions.nodePath;
  globalNodePath = Files.resolveGlobalNodePath();

  return {
    capabilities: {
      // Tell the client that the server works in FULL text document sync mode
      textDocumentSync: documents.syncKind
    }
  };
});

connection.listen();
