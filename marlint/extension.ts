import { join } from "path";
import { ExtensionContext } from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  TransportKind
} from "vscode-languageclient";

export function activate(context: ExtensionContext) {
  // We need to go one level up since an extension compile the js code into
  // the output folder.
  const serverModule = context.asAbsolutePath(join("server", "server.js"));
  const debugOptions = { execArgv: ["--nolazy", "--debug=6004"] };
  const serverOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions
    }
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: ["javascript", "javascriptreact"]
  };

  const disposable = new LanguageClient(
    "marlint",
    serverOptions,
    clientOptions
  ).start();

  context.subscriptions.push(disposable);
}
