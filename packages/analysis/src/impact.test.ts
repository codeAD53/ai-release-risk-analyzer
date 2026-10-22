
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { analyzeChangeImpact } from "./impact.js";

const execFileAsync = promisify(execFile);

test("analyzes changed files, affected files, and affected tests", async () => {
  const repo = await mkdtemp(join(tmpdir(), "impact-test-"));

  try {
    await execFileAsync("git", ["init", repo]);
    await execFileAsync("git", ["-C", repo, "config", "user.name", "Test User"]);
    await execFileAsync("git", [
      "-C", repo, "config", "user.email", "test@example.com"
    ]);

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

    await execFileAsync("git", ["-C", repo, "add", "."]);
    await execFileAsync("git", [
      "-C", repo, "commit", "-m", "Initial commit"
    ]);

    const baseCommit = (
      await execFileAsync("git", [
        "-C", repo, "rev-parse", "HEAD"
      ])
    ).stdout.trim();

    await writeFile(
      join(repo, "src", "services", "PaymentService.ts"),
      "export class PaymentService { pay() { return false; } }\n"
    );

    await execFileAsync("git", ["-C", repo, "add", "."]);
    await execFileAsync("git", [
      "-C", repo, "commit", "-m", "Change payment behavior"
    ]);

    const targetCommit = (
      await execFileAsync("git", [
        "-C", repo, "rev-parse", "HEAD"
      ])
    ).stdout.trim();

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
