import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";

export interface UnresolvedImport {
    importer: string;
    specifier: string;
}
export interface DependencyGraph {
    dependencies: Record<string, string[]>;
    dependents: Record<string, string[]>;
    unresolvedImports: UnresolvedImport[];
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORE_DIRECTORIES = new Set([
    "node_modules",
    ".git",
    "dist",
    "coverage",
    "build",
]);


async function collectSourceFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
            if (!IGNORE_DIRECTORIES.has(entry.name)) {
                files.push(...await collectSourceFiles(fullPath));
            }
        } else if (
            entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)) && !entry.name.endsWith(".d.ts")
        ) {
            files.push(fullPath);
        }
    }
    return files;
}

function extractRelativeImports(source: string): string[] {
    const sourceFile = ts.createSourceFile(
        "source.ts",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
    );
    const imports = new Set<string>();

    function addRelativeSpecifier(node: ts.Node | undefined): void {
        if (!node || !ts.isStringLiteralLike(node)) {
            return;
        }

        const specifier = node.text;
        if (specifier.startsWith("./") || specifier.startsWith("../")) {
            imports.add(specifier);
        }
    }

    function visit(node: ts.Node): void {
        if (
            (ts.isImportDeclaration(node) ||
                ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteralLike(node.moduleSpecifier)
        ) {
            addRelativeSpecifier(node.moduleSpecifier);
        }

        if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference)
        ) {
            addRelativeSpecifier(node.moduleReference.expression);
        }

        if (ts.isCallExpression(node) &&
            node.arguments.length > 0 &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) &&
                    node.expression.text === "require"))
        ) {
            addRelativeSpecifier(node.arguments[0]);
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return [...imports];
}

async function resolveImport(
    importerPath: string,
    specifier: string,
    knownFiles: Set<string>
): Promise<string | undefined> {
    const basePath = resolve(importerPath, "..", specifier);

    const candidates = [basePath];
    const extension = extname(basePath);
    if (extension === ".js") {
        const withoutExtension = basePath.slice(0, -3);
        candidates.push(`${withoutExtension}.ts`,
            `${withoutExtension}.tsx`,
        );
    } else if (extension === ".jsx") {
        const withoutExtensions = basePath.slice(0, -4);
        candidates.push(
            `${withoutExtensions}.tsx`
        );
    } else if (!extension) {
        candidates.push(...[".ts", ".tsx", ".js", ".jsx"].map((ext) => basePath + ext));
    }
    candidates.push(...["index.ts", "index.tsx", "index.js", "index.jsx"].map((filename) => join(basePath, filename)));

    for (const candidate of candidates) {
        const resolvedCandidate = resolve(candidate);
        if (knownFiles.has(resolvedCandidate)) {
            return resolvedCandidate;
        }
    }
    return undefined;
}

export async function buildDependencyGraph(repositoryPath: string): Promise<DependencyGraph> {
    const root = resolve(repositoryPath);
    const sourceFiles = await collectSourceFiles(root);

    const knownFiles = new Set(sourceFiles.map(file => resolve(file)));
    const dependencies: Record<string, string[]> = {};
    const dependents: Record<string, string[]> = {};
    const unresolvedImports: UnresolvedImport[] = [];

    for (const file of sourceFiles) {
        const relativeFile = relative(root, file).replace(/\\/g, "/");
        dependencies[relativeFile] = [];
        dependents[relativeFile] = [];
    }
    for (const file of sourceFiles) {
        const relativeFile = relative(root, file).replace(/\\/g, "/");
        const source = await readFile(file, "utf8");
        const specifiers = extractRelativeImports(source);

        for (const specifier of specifiers) {
            const resolvePath = await resolveImport(file, specifier, knownFiles);

            if (!resolvePath) {
                unresolvedImports.push({
                    importer: relative(root, file).replace(/\\/g, "/"),
                    specifier,
                });
                continue;
            }
            const dependency = relative(root, resolvePath).replace(/\\/g, "/");

            if (!dependencies[relativeFile].includes(dependency)) {
                dependencies[relativeFile].push(dependency);
            }

            if (!dependents[dependency].includes(relativeFile)) {
                dependents[dependency].push(relativeFile);
            }
        }
    }
    return { dependencies, dependents, unresolvedImports };
}


export function findAffectedFiles(
    graph: DependencyGraph,
    changedFile: string
): string[] {
    const affected = new Set<string>();
    const visited = new Set<string>([changedFile]);
    const queue = [...(graph.dependents[changedFile] ?? [])];

    while (queue.length > 0) {
        const currentFile = queue.shift()!;

        if (visited.has(currentFile)) {
            continue;
        }

        visited.add(currentFile);
        affected.add(currentFile);

        for (const dependent of graph.dependents[currentFile] ?? []) {
            if (!visited.has(dependent)) {
                queue.push(dependent);
            }
        }
    }

    return [...affected].sort();
}
