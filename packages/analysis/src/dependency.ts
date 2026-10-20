import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

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

function extractRelativeImports(source: string): string[] {
    const imports: string[] = [];
    const pattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^;]*?\s+from\s*)?["']([^"']+)["']/g;
    for(const match of source.matchAll(pattern)){
        const specifier = match[1];
        if(specifier.startsWith("./") || specifier.startsWith("../")){
            imports.push(specifier);
        }
    }
    return imports;
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
    ...["index.ts","index.tsx","index.js","indec.jsx"].map(filename => join(basePath,filename))
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
    for(const file of sourceFiles){
        const relativeFile = relative(root,file).replace(/\\/g, "/");
        const source = await readFile(file, "utf8");
        const specifiers = extractRelativeImports(source);

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
    return { dependencies, dependents };
}