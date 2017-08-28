import * as path from "path";
import * as loadJsonFile from "load-json-file";

export default class Package {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  isDependency(name: string) {
    try {
      const pkg = loadJsonFile.sync(
        path.join(this.workspaceRoot, "package.json")
      );
      const deps = pkg.dependencies || {};
      const devDeps = pkg.devDependencies || {};

      return Boolean(deps[name] || devDeps[name]);
    } catch (err) {
      if (err.code === "ENOENT") {
        return false;
      }

      throw err;
    }
  }
}
