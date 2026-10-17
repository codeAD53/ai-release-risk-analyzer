import { execFile } from "node:child_process";
import { stat } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ChangeType = "added" | "modified" | "deleted" | "renamed";

export interface ChangeFile {
    status: ChangeType;
    path: string;
    previousPath?: string;
}

export interface GitDiffResult{
    baseCommit: string;
    targetCommit: string;
    totalChangedFiles: number;
    files: ChangeFile[];
}

function isValidCommitReference(value: string): boolean {
    return /^[a-fA-F0-9]{7,40}/.test(value);
}

export async function analyzeGitDiff(
    repositoryPath: string,
    baseCommit: string,
    targetCommit: string,
): Promise<GitDiffResult>{
    if(!isValidCommitReference(baseCommit) ||
        !isValidCommitReference(targetCommit)){
            throw new Error("Base and target must be valid hexadecimal commit SHAs.");
        }
    const {stdout} = await execFileAsync(
        "git",
        [
            "-C",repositoryPath,
            "diff",
            "--name-status",
            "-M",
            "-z",
            baseCommit,
            targetCommit,
            "--"
        ],
        {
            encoding: "utf8",
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true
        }
    );

    const entries = stdout.split("\0").filter(Boolean);
    const files: ChangeFile[] = [];

    for(let i = 0;i<entries.length;){
        const statusCode = entries[i++];

        if(statusCode.startsWith("R")){
            const previousPath = entries[i++];
            const path = entries[i++];

            if(previousPath === undefined || path === undefined){
                throw new Error("Git returned an incomplete rename record.");
            }
            files.push({ status: "renamed", previousPath, path});
            continue;
        }
        const path = entries[i++];
        if(path === undefined){
            throw new Error("Git returned an incomplete file-change record.");
        }
        const statusMap: Record<string, ChangeType> = {
            A: "added",
            M: "modified",
            D: "deleted"
        };
        const status = statusMap[statusCode];
        if(!status){
            throw new Error(`Unsupported Git change status: ${statusCode}`);
        }
        files.push({status, path});
    }
    return {
        baseCommit,
        targetCommit,
        totalChangedFiles: files.length,
        files
    };
}