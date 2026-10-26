
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { analyzeChangeImpact } from "../src/impact.js";

const execFileAsync = promisify(execFile);

async function createRepository(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "impact-test-"));
  await execFileAsync("git", ["init", repo]);
  await execFileAsync("git", ["-C", repo, "config", "user.name", "Test User"]);
  await execFileAsync("git", [
    "-C", repo, "config", "user.email", "test@example.com"
  ]);
  return repo;
}

async function writeRepositoryFile(
  repo: string,
  path: string,
  contents: string
): Promise<void> {
  const fullPath = join(repo, ...path.split("/"));
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents);
}

async function commitAll(repo: string, message: string): Promise<string> {
  await execFileAsync("git", ["-C", repo, "add", "--all"]);
  await execFileAsync("git", ["-C", repo, "commit", "-m", message]);
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repo, "rev-parse", "HEAD"]
  );
  return stdout.trim();
}

test("analyzes changed files, affected files, and affected tests", async () => {
  const repo = await createRepository();

  try {
    await mkdir(join(repo, "src", "services"), { recursive: true });
    await mkdir(join(repo, "tests"), { recursive: true });

    await writeFile(
      join(repo, "src", "services", "PaymentService.ts"),
      "export class PaymentService { pay() { return true; } }\n"
    );

    await writeFile(
      join(repo, "src", "services", "OrderService.ts"),
      'import { PaymentService } from "./PaymentService";\n' +
      "export class OrderService extends PaymentService {}\n"
    );

    await writeFile(
      join(repo, "tests", "payment.test.ts"),
      'import { PaymentService } from "../src/services/PaymentService";\n' +
      "void PaymentService;\n"
    );

    await writeFile(
      join(repo, "tests", "order.test.ts"),
      'import { OrderService } from "../src/services/OrderService";\n' +
      "void OrderService;\n"
    );

    const baseCommit = await commitAll(repo, "Initial commit");

    await writeFile(
      join(repo, "src", "services", "PaymentService.ts"),
      "export class PaymentService { pay() { return false; } }\n"
    );

    const targetCommit = await commitAll(repo, "Change payment behavior");

    const result = await analyzeChangeImpact(
      repo,
      baseCommit,
      targetCommit
    );

    assert.deepEqual(
      result.diff.files.map(file => file.path),
      ["src/services/PaymentService.ts"]
    );

    assert.deepEqual(result.affectedFiles, [
      "src/services/OrderService.ts",
      "tests/order.test.ts",
      "tests/payment.test.ts"
    ]);

    assert.deepEqual(result.affectedTests, [
      "tests/order.test.ts",
      "tests/payment.test.ts"
    ]);

  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("ignores unrelated checkout state when analyzing requested commits", async () => {
  const repo = await createRepository();

  try {
    await writeRepositoryFile(
      repo,
      "src/PaymentService.ts",
      "export class PaymentService { pay() { return true; } }\n"
    );
    await writeRepositoryFile(
      repo,
      "src/OrderService.ts",
      'import { PaymentService } from "./PaymentService";\n' +
      "export class OrderService extends PaymentService {}\n"
    );
    const baseCommit = await commitAll(repo, "Initial commit");

    await writeRepositoryFile(
      repo,
      "src/PaymentService.ts",
      "export class PaymentService { pay() { return false; } }\n"
    );
    const targetCommit = await commitAll(repo, "Change payment behavior");

    await execFileAsync("git", ["-C", repo, "checkout", "-b", "unrelated"]);
    await writeRepositoryFile(
      repo,
      "src/CheckoutOnly.ts",
      'import { PaymentService } from "./PaymentService";\n' +
      "export class CheckoutOnly extends PaymentService {}\n"
    );
    await commitAll(repo, "Add unrelated checkout-only importer");

    const result = await analyzeChangeImpact(repo, baseCommit, targetCommit);

    assert.deepEqual(result.affectedFiles, ["src/OrderService.ts"]);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("finds former importers when a source file is deleted", async () => {
  const repo = await createRepository();

  try {
    await writeRepositoryFile(
      repo,
      "src/PaymentService.ts",
      "export class PaymentService {}\n"
    );
    await writeRepositoryFile(
      repo,
      "src/OrderService.ts",
      'import { PaymentService } from "./PaymentService";\n' +
      "export class OrderService extends PaymentService {}\n"
    );
    const baseCommit = await commitAll(repo, "Initial commit");

    await rm(join(repo, "src", "PaymentService.ts"));
    const targetCommit = await commitAll(repo, "Delete payment service");

    const result = await analyzeChangeImpact(repo, baseCommit, targetCommit);

    assert.deepEqual(result.diff.files, [
      { status: "deleted", path: "src/PaymentService.ts" }
    ]);
    assert.deepEqual(result.affectedFiles, ["src/OrderService.ts"]);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("finds former importers when a source file is renamed", async () => {
  const repo = await createRepository();

  try {
    await writeRepositoryFile(
      repo,
      "src/PaymentService.ts",
      "export class PaymentService {}\n"
    );
    await writeRepositoryFile(
      repo,
      "src/OrderService.ts",
      'import { PaymentService } from "./PaymentService";\n' +
      "export class OrderService extends PaymentService {}\n"
    );
    const baseCommit = await commitAll(repo, "Initial commit");

    await rename(
      join(repo, "src", "PaymentService.ts"),
      join(repo, "src", "BillingService.ts")
    );
    const targetCommit = await commitAll(repo, "Rename payment service");

    const result = await analyzeChangeImpact(repo, baseCommit, targetCommit);

    assert.deepEqual(result.diff.files, [
      {
        status: "renamed",
        previousPath: "src/PaymentService.ts",
        path: "src/BillingService.ts"
      },
    ]);
    assert.deepEqual(result.affectedFiles, ["src/OrderService.ts"]);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("includes a directly changed test in affectedTests", async () => {
  const repo = await createRepository();

  try {
    await writeRepositoryFile(
      repo,
      "src/PaymentService.ts",
      "export class PaymentService {}\n"
    );
    await writeRepositoryFile(
      repo,
      "tests/payment.test.ts",
      'import { PaymentService } from "../src/PaymentService";\n' +
      "void PaymentService;\n"
    );
    const baseCommit = await commitAll(repo, "Initial commit");

    await writeRepositoryFile(
      repo,
      "tests/payment.test.ts",
      'import { PaymentService } from "../src/PaymentService";\n' +
      "void PaymentService;\n" +
      "assert.ok(new PaymentService());\n"
    );
    const targetCommit = await commitAll(repo, "Update payment test");

    const result = await analyzeChangeImpact(repo, baseCommit, targetCommit);

    assert.deepEqual(result.affectedTests, [
      "tests/payment.test.ts"
    ]);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("detects a newly unresolved import", async () => {
  const repo = await createRepository();

  try {
    await writeRepositoryFile(
      repo,
      "src/PaymentService.ts",
      "export class PaymentService {}\n"
    );

    await writeRepositoryFile(
      repo,
      "src/OrderService.ts",
      'import { PaymentService } from "./PaymentService";\n' +
      "export class OrderService extends PaymentService {}\n"
    );

    const baseCommit = await commitAll(repo, "Initial commit");

    await rm(join(repo, "src", "PaymentService.ts"));

    const targetCommit = await commitAll(
      repo,
      "Delete payment service"
    );

    const result = await analyzeChangeImpact(
      repo,
      baseCommit,
      targetCommit
    );

    assert.deepEqual(result.newlyUnresolvedImports, [
      {
        importer: "src/OrderService.ts",
        specifier: "./PaymentService",
      },
    ]);

    assert.ok(result.risk.score > 0);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});


test("does not report pre-existing unresolved imports as new", async () => {
  const repo = await createRepository();

  try {
    await writeRepositoryFile(
      repo,
      "src/OrderService.ts",
      'import { MissingService } from "./MissingService";\n' +
      "export class OrderService extends MissingService {}\n"
    );

    const baseCommit = await commitAll(repo, "Initial commit");

    // Change unrelated code without fixing the existing unresolved import.
    await writeRepositoryFile(
      repo,
      "src/CheckoutService.ts",
      "export class CheckoutService {}\n"
    );

    const targetCommit = await commitAll(
      repo,
      "Add checkout service"
    );

    const result = await analyzeChangeImpact(
      repo,
      baseCommit,
      targetCommit
    );

    assert.deepEqual(result.newlyUnresolvedImports, []);

  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});


test("does not report an existing unresolved import as new when its importer is renamed", async () => {
  const repo = await createRepository();

  try {
    await writeRepositoryFile(
      repo,
      "src/OrderService.ts",
      'import { MissingService } from "./MissingService";\n' +
      "export class OrderService extends MissingService {}\n"
    );

    const baseCommit = await commitAll(repo, "Initial commit");

    // Rename the importer without changing its unresolved import.
    await rename(
      join(repo, "src", "OrderService.ts"),
      join(repo, "src", "PurchaseService.ts")
    );

    const targetCommit = await commitAll(
      repo,
      "Rename order service"
    );

    const result = await analyzeChangeImpact(
      repo,
      baseCommit,
      targetCommit
    );

    assert.deepEqual(result.newlyUnresolvedImports, []);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});


test("detects a newly unresolved import introduced by a changed file", async () => {
    const repo = await createRepository();

    try {
        await writeRepositoryFile(
            repo,
            "src/PaymentService.ts",
            "export class PaymentService {}\n"
        );

        await writeRepositoryFile(
            repo,
            "src/OrderService.ts",
            'import { PaymentService } from "./PaymentService";\n' +
            "export class OrderService extends PaymentService {}\n"
        );

        const baseCommit = await commitAll(repo, "Initial commit");

        await writeRepositoryFile(
            repo,
            "src/OrderService.ts",
            'import { MissingService } from "./MissingService";\n' +
            "export class OrderService extends MissingService {}\n"
        );

        const targetCommit = await commitAll(
            repo,
            "Introduce unresolved import"
        );

        const result = await analyzeChangeImpact(
            repo,
            baseCommit,
            targetCommit
        );

        assert.deepEqual(result.newlyUnresolvedImports, [
            {
                importer: "src/OrderService.ts",
                specifier: "./MissingService",
            },
        ]);

        assert.ok(result.risk.score > 0);
    } finally {
        await rm(repo, { recursive: true, force: true });
    }
});


