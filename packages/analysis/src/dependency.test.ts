import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDependencyGraph } from "./dependency.js";

test("builds dependencies and reverse dependents", async() => {
    const repo = await mkdtemp(join(tmpdir(), "dependency-test-"));
    try{
        await mkdir(join(repo,"src"), {recursive: true});
        await mkdir(join(repo, "tests"), {recursive: true});

        await writeFile(join(repo, "src", "PaymentService.ts"),
        "export class PaymentService {}"
        );
        await writeFile(
            join(repo,"src","OrderService.ts"),
            'import {PaymentService} from "./PaymentService"; \n' + 
            "export class OrderService extends PaymentService {}"
        );

        await writeFile(join(repo,"tests", "order.test.ts"),
        'import {OrderService} from "../src/OrderService.ts";\n' +
        "void OrderService;"
    );

    const graph = await buildDependencyGraph(repo);

    assert.deepEqual(
        graph.dependencies["src/OrderService.ts"],["src/PaymentService.ts"]
    );

    assert.deepEqual(
        graph.dependents["src/PaymentService.ts"],["src/OrderService.ts"]
    );

    assert.deepEqual(
        graph.dependents["src/OrderService.ts"],
        ["tests/order.test.ts"]
    );
    } finally {
        await rm(repo, {recursive: true, force: true});
    }
});