import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { analyzeGitDiff } from "./index.js";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);
async function git(
    repo:string,
    args:string[]
): Promise<string> {
    const {stdout} = await execFileAsync(
        "git",
        ["-C",repo, ...args],
        {encoding: "utf8", windowsHide: true}
    );
    return stdout.trim();
}

async function createTestRepo() {
    const repo = await mkdtemp(join(tmpdir(), "release-risk-test-"));
    await git(repo, ["init"]);
    await git(repo, ["config", "user.name", "Release Risk Tests"]);
    await git(repo,["config", "user.email", "tests@example.com"]);

    return repo;
}

async function commit(repo:string, message: string): Promise<string> {
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "--allow-empty", "-m",message]);
    return git(repo, ["rev-parse","HEAD"]);
}

test("detects an added file",async ()=>{
    const repo = await createTestRepo();
    try{
        const base = await commit(repo,"base");
        await writeFile(join(repo, "new.txt"),"hello");
        const target = await commit(repo, "add file");
        const result = await analyzeGitDiff(repo,base,target);

        assert.equal(result.totalChangedFiles, 1);
        assert.deepEqual(result.files,[
            { status: "added", path: "new.txt" }
        ]);
    }finally{
        await rm(repo, {recursive: true, force: true });
    }
});

test("detects a modified test",async()=>{
    const repo = await createTestRepo();
    try{
        await writeFile(join(repo,"app.txt"), "before");
        const base = await commit(repo,"base");

        await writeFile(join(repo, "app.txt"), "after");
        const target = await commit(repo,"modify file");

        const result = await analyzeGitDiff(repo,base,target);

        assert.deepEqual(result.files,[
            { status: "modified", path: "app.txt"}
        ]);
    } finally {
        await rm(repo, {recursive: true, force: true});
    }
});

test("detects a deleted file", async () => {
    const repo = await createTestRepo();
    try {
        await writeFile(join(repo,"old.txt"),"remove me");
        const base = await commit(repo, "base");

        await unlink(join(repo,"old.txt"));
        const target = await commit(repo,"delete file");

        const result = await analyzeGitDiff(repo,base,target);
        assert.deepEqual(result.files,[
            {status: "deleted", path: "old.txt"}
        ]);
    } finally {
        await rm(repo, {recursive: true, force: true});
    }
});

test("detects a renamed file", async () => {
    const repo = await createTestRepo();
    try {
        await writeFile(join(repo,"old-name.txt"),"This content is long enough for Git to detect a rename reliably.");
        const base = await commit(repo, "base");

        await rename(join(repo,"old-name.txt"), join(repo,"new-name.txt"));
        const target = await commit(repo,"rename file");

        const result = await analyzeGitDiff(repo,base,target);
        assert.deepEqual(result.files,[
            {status: "renamed", 
             previousPath: "old-name.txt",
             path: "new-name.txt"
            }
        ]);
    } finally {
        await rm(repo, {recursive: true, force: true});
    }
});

test("rejects invalid commit references",async() => {{
    await assert.rejects(
        analyzeGitDiff("unused","not-a-sha","also-invalid"),
        /valid hexadecimal commit SHAs/
    );
}});