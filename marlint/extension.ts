import * as path from "path";
import {
  LanguageClient,
  LanguageClientOptions,
  TransportKind
} from "vscode-languageclient";

export function activate() {
  // We need to go one level up since an extension compile the js code into
  // the output folder.
  const serverModule = path.join(__dirname, "..", "server", "server.js");
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

  return new LanguageClient("marlint", serverOptions, clientOptions);
}
