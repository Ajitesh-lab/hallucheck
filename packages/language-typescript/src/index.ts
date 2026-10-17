import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { Lru, hash } from "../../shared/src/index.js";
import { excluded } from "../../core/src/security/index.js";
export interface Inspection {
  diagnostics: {
    code: number;
    message: string;
    file?: string;
    line?: number;
  }[];
  symbols: string[];
  exports: string[];
  imports: { module: string; resolved: boolean }[];
}
export class TypeScriptAnalyzer {
  private lookups = new Set<string>();
  private lookupOverflow = false;
  private fingerprintNonce = 0;
  fingerprint(): string {
    if (this.lookupOverflow)
      return `uncached-overflow-${this.fingerprintNonce++}`;
    return hash(
      [...this.lookups].sort().map((file) => {
        try {
          const st = fs.statSync(file, { bigint: true });
          return [
            file,
            st.ino.toString(),
            st.size.toString(),
            st.mtimeNs.toString(),
            st.ctimeNs.toString(),
          ];
        } catch {
          return [file, "missing"];
        }
      }),
    );
  }
  private note(file: string): void {
    if (
      file.startsWith(this.root + path.sep) &&
      file.split(path.sep).includes("node_modules")
    ) {
      if (this.lookups.size < 4096) this.lookups.add(file);
      else if (!this.lookups.has(file)) this.lookupOverflow = true;
    }
  }
  private cache = new Lru<string, ts.Program>(2);
  private results = new Lru<string, Inspection>(128);
  constructor(
    readonly root: string,
    readonly exclusions: string[] = [],
  ) {
    this.root = fs.realpathSync(root);
  }
  private allowed(file: string): boolean {
    try {
      const actual = fs.realpathSync(file);
      const lib = fs.realpathSync(path.dirname(ts.getDefaultLibFilePath({})));
      return (
        actual.startsWith(lib + path.sep) ||
        (actual.startsWith(this.root + path.sep) &&
          !excluded(path.relative(this.root, actual), this.exclusions, true))
      );
    } catch {
      return false;
    }
  }
  private read = (file: string): string | undefined => {
    this.note(file);
    if (!this.allowed(file)) return;
    try {
      if (fs.statSync(file).size > 2_000_000) return;
      return fs.readFileSync(file, "utf8");
    } catch {
      return;
    }
  };
  private host(): ts.CompilerHost {
    const host = ts.createCompilerHost({});
    host.getCurrentDirectory = () => this.root;
    host.readFile = this.read;
    host.fileExists = (f) => {
      this.note(f);
      return this.allowed(f) && fs.existsSync(f);
    };
    const directoryExists = host.directoryExists;
    host.directoryExists = (f) => {
      this.note(f);
      return directoryExists?.(f) ?? false;
    };
    host.getSourceFile = (file, language) => {
      const content = this.read(file);
      return content === undefined
        ? undefined
        : ts.createSourceFile(file, content, language, true);
    };
    host.writeFile = () => {
      throw new Error("Read-only compiler");
    };
    return host;
  }
  private program(files: string[], snapshot: string): ts.Program {
    const base = snapshot + hash([...files].sort());
    const cached = this.cache.get(base + this.fingerprint());
    if (cached) return cached;
    let options: ts.CompilerOptions = {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowJs: true,
      checkJs: true,
      types: [],
    };
    const configPath = path.join(this.root, "tsconfig.json");
    if (this.read(configPath)) {
      const read = ts.readConfigFile(configPath, this.read);
      if (read.error) throw new Error("Invalid tsconfig");
      const parsed = ts.parseJsonConfigFileContent(
        read.config,
        {
          ...ts.sys,
          readFile: this.read,
          fileExists: (f) => this.allowed(f) && fs.existsSync(f),
        },
        this.root,
      );
      if (parsed.errors.length)
        throw new Error(
          ts.flattenDiagnosticMessageText(parsed.errors[0]!.messageText, " "),
        );
      options = { ...options, ...parsed.options, noEmit: true, plugins: [] };
    }
    const program = ts.createProgram(
      files.map((f) => path.resolve(this.root, f)),
      options,
      this.host(),
    );
    this.cache.set(base + this.fingerprint(), program);
    return program;
  }
  inspect(file: string, files: string[], snapshot: string): Inspection {
    const base = snapshot + file + hash([...files].sort());
    const key = base + this.fingerprint();
    const cached = this.results.get(key);
    if (cached) return cached;
    const program = this.program(files, snapshot);
    const target = path.resolve(this.root, file);
    const source = program.getSourceFile(target);
    if (!source) throw new Error("Source unavailable or excluded");
    const checker = program.getTypeChecker();
    const diagnostics = [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
      ...program.getOptionsDiagnostics(),
    ].map((d) => ({
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
      ...(d.file
        ? {
            file: path.relative(this.root, d.file.fileName),
            line: d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1,
          }
        : {}),
    }));
    const symbols = checker
      .getSymbolsInScope(
        source,
        ts.SymbolFlags.Value | ts.SymbolFlags.Type | ts.SymbolFlags.Namespace,
      )
      .map((s) => s.getName());
    const moduleSymbol = checker.getSymbolAtLocation(source);
    const exports = moduleSymbol
      ? checker.getExportsOfModule(moduleSymbol).map((s) => s.getName())
      : [];
    const imports: Inspection["imports"] = [];
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const name = node.moduleSpecifier.text;
        const resolved = ts.resolveModuleName(
          name,
          target,
          program.getCompilerOptions(),
          this.host(),
        ).resolvedModule;
        imports.push({
          module: name,
          resolved:
            !!resolved || !!checker.getSymbolAtLocation(node.moduleSpecifier),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    const result = { diagnostics, symbols, exports, imports };
    this.results.set(base + this.fingerprint(), result);
    return result;
  }
}
