import { readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { API } from "typescript/unstable/sync";
import {
    isCallExpression,
    isExternalModuleReference,
    isExportDeclaration,
    isIdentifier,
    isImportEqualsDeclaration,
    isImportDeclaration,
    isNoSubstitutionTemplateLiteral,
    isStringLiteral
} from "typescript/unstable/ast/is";
import { SyntaxKind, type Node, type SourceFile } from "typescript/unstable/ast";
export interface DependencyGraph{
    dependencies: Record<string, string[]>;
    dependents: Record<string,string[]>;
}

const SOURCE_EXTENSIONS = new Set([".ts",".tsx",".js",".jsx"]);

async function collectSourceFiles(directory:string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true});
    const files:string[] = [];
    for(const entry of entries){
        const fullPath = join(directory, entry.name);
        if(entry.isDirectory()){

            const ignoredDirectories = new Set([
                "node_modules",
                ".git",
                "dist",
                "coverage",
                "build"
            ]);
            if(!ignoredDirectories.has(entry.name)){
            files.push(...await collectSourceFiles(fullPath));
        }
        }else if(
            entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)) && !entry.name.endsWith(".d.ts")
        ){
            files.push(fullPath);
        }
    }
    return files;
}

function extractRelativeImports(sourceFile: SourceFile): string[] {
    const imports = new Set<string>();

    function addRelativeSpecifier(node: Node | undefined): void {
        if(!node || (!isStringLiteral(node) && !isNoSubstitutionTemplateLiteral(node))){
            return;
        }

        const specifier = node.text;
        if(specifier.startsWith("./") || specifier.startsWith("../")){
            imports.add(specifier);
        }
    }

    function visit(node: Node): void {
        if(
            (isImportDeclaration(node) ||
                isExportDeclaration(node)) &&
                node.moduleSpecifier &&
                isStringLiteral(node.moduleSpecifier)
        ){
            addRelativeSpecifier(node.moduleSpecifier);
        }

        if(
            isImportEqualsDeclaration(node) &&
            isExternalModuleReference(node.moduleReference)
        ){
            addRelativeSpecifier(node.moduleReference.expression);
        }

        if(isCallExpression(node) &&
            node.arguments.length > 0 &&
            (node.expression.kind === SyntaxKind.ImportKeyword ||
                (isIdentifier(node.expression) &&
            node.expression.text === "require"))
        ){
            addRelativeSpecifier(node.arguments[0]);
        }
        node.forEachChild(visit);
    }
    sourceFile.forEachChild(visit);
    return [...imports];
}

async function resolveImport(
    importerPath:string,
    specifier: string,
    knownFiles: Set<string>
): Promise<string | undefined> {
    const basePath = resolve(importerPath, "..", specifier);

    const candidates = [basePath, ...[".ts", ".tsx", ".js",".jsx"].map(
        extension => basePath + extension
    ),
    ...["index.ts","index.tsx","index.js","index.jsx"].map(filename => join(basePath,filename))
];

for(const candidate of candidates){
    if(knownFiles.has(candidate)){
        return candidate;
    }
}
return undefined;
}

export async function buildDependencyGraph(repositoryPath:string):Promise<DependencyGraph> {
    const root = resolve(repositoryPath);
    const sourceFiles = await collectSourceFiles(root);

    const knownFiles = new Set(sourceFiles.map(file => resolve(file)));
    const dependencies: Record<string, string[]> = {};
    const dependents: Record<string, string[]> = {};

    for(const file of sourceFiles){
        const relativeFile = relative(root,file).replace(/\\/g, "/");
        dependencies[relativeFile] = [];
        dependents[relativeFile] = [];
    }
    const api = new API({ cwd: root });
    try {
        const snapshot = api.updateSnapshot({ openFiles: sourceFiles });
        try {
            for(const file of sourceFiles){
                const relativeFile = relative(root,file).replace(/\\/g, "/");
                const sourceFile = snapshot
                    .getDefaultProjectForFile(file)
                    ?.program.getSourceFile(file);
                if(!sourceFile){
                    throw new Error(`TypeScript could not parse source file: ${file}`);
                }
                const specifiers = extractRelativeImports(sourceFile);

                for(const specifier of specifiers){
                    const resolvePath = await resolveImport(file, specifier, knownFiles);

                    if(!resolvePath){
                        continue;
                    }
                    const dependency = relative(root, resolvePath).replace(/\\/g, "/");

                    if(!dependencies[relativeFile].includes(dependency)){
                        dependencies[relativeFile].push(dependency);
                    }

                    if(!dependents[dependency].includes(relativeFile)){
                        dependents[dependency].push(relativeFile);
                    }
                }
            }
        } finally {
            snapshot.dispose();
        }
    } finally {
        api.close();
    }
    return { dependencies, dependents };
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
