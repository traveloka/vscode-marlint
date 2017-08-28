import {
  createConnection,
  IConnection,
  ResponseError,
  InitializeResult,
  InitializeError,
  Diagnostic,
  DiagnosticSeverity,
  Files,
  TextDocuments,
  TextDocument,
  ErrorMessageTracker,
  IPCMessageReader,
  IPCMessageWriter
} from "vscode-languageserver";
import Package from "./package";

class Linter {
  private connection: IConnection;
  private documents: TextDocuments;
  private package: Package;

  private workspaceRoot: string;
  private lib: any;
  private options: any;

  constructor() {
    this.connection = createConnection(
      new IPCMessageReader(process),
      new IPCMessageWriter(process)
    );
    this.documents = new TextDocuments();

    // Listen for text document create, change
    this.documents.listen(this.connection);

    // Validate document if it changed
    this.documents.onDidChangeContent(event => {
      this.validateSingle(event.document);
    });

    // Clear the diagnostics when document is closed
    this.documents.onDidClose(event => {
      this.connection.sendDiagnostics({
        uri: event.document.uri,
        diagnostics: []
      });
    });

    this.connection.onInitialize(this.initialize.bind(this));

    this.connection.onDidChangeWatchedFiles(() => {
      this.validateMany(this.documents.all());
    });
  }

  public listen(): void {
    this.connection.listen();
  }

  private initialize(params: { rootPath: string }) {
    this.workspaceRoot = params.rootPath;

    this.package = new Package(this.workspaceRoot);

    return this.resolveModule();
  }

  private resolveModule(): Thenable<
    void | InitializeResult | ResponseError<InitializeError>
  > {
    const result: InitializeResult = {
      capabilities: {
        textDocumentSync: this.documents.syncKind,
        codeActionProvider: true
      }
    };

    if (this.lib) {
      return Promise.resolve(result);
    }

    return Files.resolveModule(this.workspaceRoot, "marlint").then(
      (marlint: any) => {
        if (!marlint.lintText) {
          return new ResponseError(
            99,
            "Marlint doesn't export a lintText method.",
            { retry: false }
          );
        }

        this.lib = marlint;

        return result;
      },
      () => {
        if (this.package.isDependency("marlint")) {
          throw new ResponseError<
            InitializeError
          >(
            99,
            "Failed to load marlint. Make sure marlint is installed in your workspace folder and then press Retry.",
            { retry: true }
          );
        }
      }
    );
  }

  private validateMany(documents: TextDocument[]): Thenable<void> {
    const tracker = new ErrorMessageTracker();

    const promises = documents.map(document => {
      return this.validate(document).then(
        () => {},
        err => {
          tracker.add(this.getMessage(err, document));
        }
      );
    });

    return Promise.all(promises).then(() => {
      tracker.sendErrors(this.connection);
    });
  }

  private validateSingle(document: TextDocument): Thenable<void> {
    return this.validate(document).then(
      () => {},
      (err: Error) => {
        this.connection.window.showErrorMessage(this.getMessage(err, document));
      }
    );
  }

  private validate(document: TextDocument): Thenable<void> {
    if (!this.package.isDependency("marlint")) {
      // Do not validate if `marlint` is not a dependency
      return Promise.resolve();
    }

    return this.resolveModule().then(() => {
      const uri = document.uri;
      const fsPath = Files.uriToFilePath(uri);
      const contents = document.getText();

      if (fsPath === null) {
        return;
      }

      const options: any = this.options;
      options.cwd = this.workspaceRoot;
      options.filename = fsPath;

      const report = this.lib.lintText(contents, options);

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

      this.connection.sendDiagnostics({ uri, diagnostics });
    });
  }

  private getMessage(err: any, document: TextDocument): string {
    if (typeof err.message === "string" || err.message instanceof String) {
      return <string>err.message;
    } else {
      return `An unknown error occurred while validating file: ${Files.uriToFilePath(
        document.uri
      )}`;
    }
  }
}

new Linter().listen();
