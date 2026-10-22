import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDependencyGraph, findAffectedFiles } from "./dependency.js";
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

test("ignore files inside node_modules", async () => {
    const repo = await mkdtemp(join(tmpdir(), "dependency-ignore-test-"));

    try{
        await mkdir(join(repo, "src"), {recursive: true});
        await mkdir(join(repo,"node_modules","fake-package"),{
            recursive: true
        });
        await writeFile(
            join(repo,"src","App.ts"),
            "export const app = true;"
        );

        await writeFile(join(repo, "node_modules","fake-package","index.ts"),
    "export const fake = true;");

    const graph = await buildDependencyGraph(repo);

    assert.ok(graph.dependencies["src/App.ts"]);
    assert.ok(!Object.keys(graph.dependencies).some(path => path.startsWith("node_modules/")));
    }finally{
        await rm(repo, {recursive: true, force: true});
    }
});

test("finds all transitively affected files", async () => {
    const repo = await mkdtemp(join(tmpdir(), "affected-test-"));
  try {
    await mkdir(join(repo, "src", "services"), { recursive: true });
    await mkdir(join(repo, "tests"), { recursive: true });

    await writeFile(
      join(repo, "src", "services", "PaymentService.ts"),
      "export class PaymentService {}"
    );

    await writeFile(
      join(repo, "src", "services", "OrderService.ts"),
      'import { PaymentService } from "./PaymentService";\n' +
      "export class OrderService extends PaymentService {}"
    );

    await writeFile(
      join(repo, "tests", "order.test.ts"),
      'import { OrderService } from "../src/services/OrderService";\n' +
      "void OrderService;"
    );

    const graph = await buildDependencyGraph(repo);

    const affected = findAffectedFiles(
      graph,
      "src/services/PaymentService.ts"
    );

    assert.deepEqual(affected, [
      "src/services/OrderService.ts",
      "tests/order.test.ts"
    ]);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
