import test from "node:test";
import assert from "node:assert/strict";

import { calculateReleaseRisk, getRiskCategory } from "../src/risk.js";

test("returns zero risk when no files changed and at least three affected tests are identified", () => {
    const result = calculateReleaseRisk({
        changedFiles: 0,
        affectedFiles: 0,
        affectedTests: 3,
        newUnresolvedImports: 0,
    });
    assert.equal(result.score, 0);
    assert.equal(result.category, "Low");
});

test("calculates the expected risk score for a typical release", () => {
    const result = calculateReleaseRisk({
        changedFiles: 4,
        affectedFiles: 7,
        affectedTests: 1,
        newUnresolvedImports: 0,
    });
    assert.equal(result.score, 52);
    assert.equal(result.category, "High");
});

test("returns a factor breakdown with explanations", () => {
    const result = calculateReleaseRisk({
        changedFiles: 4,
        affectedFiles: 7,
        affectedTests: 1,
        newUnresolvedImports: 0,
    });
    assert.equal(result.factors.length, 4);
    assert.deepEqual(result.factors.map((factor) => factor.points), [20, 30, 20,0]);

    assert.ok(result.factors.every((factor) => 
    factor.explanation.length > 0
    ));
});

test("classifies a score of 25 as Moderate", () => {

    assert.equal(getRiskCategory(25), "Moderate");
});

test("classfies a score of 50 as High", () => {
   
    assert.equal(getRiskCategory(50), "High");
});

test("classifies a score of 75 as Critical", () => {
  
    assert.equal(getRiskCategory(75), "Critical");
});

test("increases risk when no affected tests are identified", () => {
    const withoutTests = calculateReleaseRisk({
        changedFiles: 1,
        affectedFiles: 1,
        affectedTests: 0,
        newUnresolvedImports: 0,
    });

    const withTests = calculateReleaseRisk({
        changedFiles: 1,
        affectedFiles: 1,
        affectedTests: 3,
        newUnresolvedImports: 0,
    });

    assert.ok(withoutTests.score > withTests.score);
});

test("increases risk for newly unresolved imports", () => {
    const withoutResolvedImports = calculateReleaseRisk({
        changedFiles: 1,
        affectedFiles: 1,
        affectedTests: 3,
        newUnresolvedImports: 0,
    });

    const withResolvedImports = calculateReleaseRisk({
        changedFiles: 1,
        affectedFiles: 1,
        affectedTests: 3,
        newUnresolvedImports: 1,
    });

    assert.ok(withResolvedImports.score > withoutResolvedImports.score);
});
