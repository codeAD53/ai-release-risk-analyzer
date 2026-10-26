import { analyzeGitDiff, type GitDiffResult } from "./index.js";
import { calculateReleaseRisk, type ReleaseRiskResult } from "./risk.js";
import { buildDependencyGraph, findAffectedFiles, type DependencyGraph, type UnresolvedImport } from "./dependency.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const execFileSync = promisify(execFile);
export interface ImpactAnalysisResult{
    diff: GitDiffResult,
    affectedFiles: string[];
    affectedTests: string[];
    newlyUnresolvedImports: UnresolvedImport[];
    risk: ReleaseRiskResult;
}

function isTestPath(file: string): boolean {
    return /(^|\/)(__tests__\/|tests?\/)|\.(test|spec)\.[jt]sx?$/.test(file);
}

function getUnresolvedImportKey(unresolvedImport:{
    importer: string,
    specifier: string
}):string{
    return `${unresolvedImport.importer}::${unresolvedImport.specifier}`;
}

async function buildGraphAtCommit(repositoryPath:string,
    commit: string
): Promise<DependencyGraph> {
    const tempRoot = await mkdtemp(join(tmpdir(),"release-impact-"));
    const workTreePath = join(tempRoot, "workTree");
    let workTreeCreated = false;

    try {
        await execFileSync(
        "git",
        ["-C",repositoryPath,"worktree","add","--detach",workTreePath,commit],
        {windowsHide: true});

        workTreeCreated = true;
        return await buildDependencyGraph(workTreePath);
       } finally {
        if(workTreeCreated){
            try{
                await execFileSync(
                    "git",
                    ["-C",repositoryPath,"worktree","remove","--force",workTreePath],
                    {windowsHide:true}
               );
            }finally{
                await rm(tempRoot, {recursive: true, force: true});
            }
        }else{
            await rm(tempRoot, { recursive: true, force: true });
        }
    }
}

export async function analyzeChangeImpact(repositoryPath:string,
    baseCommit: string,
    targetCommit: string
): Promise<ImpactAnalysisResult> {
    const diff = await analyzeGitDiff(
        repositoryPath,
        baseCommit,
        targetCommit
    );
    const baseGraph = await buildGraphAtCommit(repositoryPath, baseCommit);
    const targetGraph = await buildGraphAtCommit(repositoryPath, targetCommit);
    const renamedPaths = new Map(
        diff.files.filter(file => file.status === "renamed" && file.previousPath)
        .map(file => [file.previousPath!, file.path]),
    );
    const baseUnresolvedImport = new Set(
        baseGraph.unresolvedImports.map(unresolvedImport => {
            const renamedImporter = renamedPaths.get(unresolvedImport.importer) ?? unresolvedImport.importer;
            return getUnresolvedImportKey({
                importer: renamedImporter,
                specifier: unresolvedImport.specifier
            })
        }));
    const newlyUnresolvedImports = targetGraph.unresolvedImports.filter((unresolvedImport)=>
        !baseUnresolvedImport.has(getUnresolvedImportKey(unresolvedImport)));

    const affected = new Set<string>();

    for(const file of diff.files){
        const changedPaths = file.previousPath ? [file.previousPath, file.path]:[file.path];
        for(const changePath of changedPaths){
            for(const graph of [baseGraph, targetGraph]){
                for(const affectedFile of findAffectedFiles(graph,changePath)){
                    affected.add(affectedFile);
                }
            }
        }
    }
    const changedPaths = new Set(
        diff.files.flatMap(file => 
            file.previousPath ? [file.path, file.previousPath] : [file.path])
    );

    
    const affectedFiles = [...affected]
            .filter(file => !changedPaths.has(file))
            .sort();
    
    const directlyChangeTests = diff.files.flatMap(file => [file.path, ...(file.previousPath ? [file.previousPath] : [])]).filter(isTestPath);
    const affectedTests = [...new Set([
        ...directlyChangeTests,
        ...affectedFiles.filter(isTestPath)
    ])].sort();

    const targetTestPaths = new Set(
        Object.keys(targetGraph.dependencies).filter(isTestPath),
    );

    const existingAffectedTests = affectedTests.filter((file) => targetTestPaths.has(file));
    
    const risk = calculateReleaseRisk({
        changedFiles: diff.totalChangedFiles,
        affectedFiles: affectedFiles.length,
        affectedTests: affectedTests.length,
        newUnresolvedImports: newlyUnresolvedImports.length,
    })
    return {
        diff,
        affectedFiles,
        affectedTests,
        newlyUnresolvedImports,
        risk,
    };
}