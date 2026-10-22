import { analyzeGitDiff, type GitDiffResult } from "./index.js";
import { buildDependencyGraph, findAffectedFiles } from "./dependency.js";

export interface ImpactAnalysisResult{
    diff: GitDiffResult,
    affectedFiles: string[];
    affectedTests: string[];
}

export async function analyzeChangeImpact(repositoryPath:string,
    baseCommit: string,
    targetCommit: string
): Promise<ImpactAnalysisResult> {
    const diff = await analyzeGitDiff(repositoryPath,baseCommit,targetCommit);
    const graph = await buildDependencyGraph(repositoryPath);
    const affected = new Set<string>();
    for(const file of diff.files){
        const changedPaths = [file.path];
        if(file.previousPath){
            changedPaths.push(file.previousPath);
        }
        for(const changePath of changedPaths){
            for(const affectedFile of findAffectedFiles(graph,changePath)){
                affected.add(affectedFile);
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
    
    const affectedTests = affectedFiles.filter(file => /(^|\/)(__tests__\/|tests?\/)|\.(test|spec)\.[jt]sx?$/.test(file));

    return {
        diff,
        affectedFiles,
        affectedTests,
    };
}