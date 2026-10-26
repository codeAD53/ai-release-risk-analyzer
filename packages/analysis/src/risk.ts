export type RiskCategory = "Low" | "Moderate" | "High" | "Critical";

export interface RiskFactor{
    name: string;
    points: number;
    explanation: string;
}

export interface ReleaseRiskResult {
    score: number;
    category: RiskCategory;
    factors: RiskFactor[];
}

function scoreChangedFiles(count: number): RiskFactor{
    let points: number;
    if(count === 0){
        points = 0;
    }else if(count === 1){
        points = 5;
    }else if(count <= 3){
        points = 10;
    }else if(count <=6){
        points = 20;
    }else{
        points = 30;
    }
    return{
        name: "Changes files",
        points,
        explanation: `${count} file(s) changed in this release`,
    };
}

function scoreAffectedFiles(count: number):RiskFactor{
    let points: number;
    if(count === 0){
        points = 0;
    }else if(count <= 2){
        points = 10;
    }else if(count <=5){
        points = 20;
    }else if(count <= 10){
        points = 30;
    }else{
        points = 40;
    }
    return {
        name: "Indirectly affected files",
        points,
        explanation: `${count} additional file(s) may be affected by the changes.`,
    };
}

function scoreAffectedTests(count: number): RiskFactor{
    let points: number;
    if(count === 0){
        points = 30;
    }else if(count === 1){
        points = 20;
    }else if(count === 2){
        points = 10;
    }else{
        points = 0;
    }
    return {
        name: "Affected tests",
        points,
        explanation: 
            count === 0
                ? "No affected tests were identified, increasing testing uncertainty."
                : `${count} potentially affected test(s) were identified.`,
    }
}

function scoreUnresolvedImports(count: number):RiskFactor{
    let points: number;
    if(count === 0){
        points = 0;
    }else if(count === 1){
        points = 15;
    }else if(count <= 3){
        points = 25;
    }else{
        points = 35;
    }
    return {
        name: "New unresolved imports",
        points,
        explanation: count === 0 ? "No newly unresolved imports were indentified." : `${count} newly unresolved local import(s) may indicate broken dependencies.`,
    };
}

export function getRiskCategory(score: number): RiskCategory{
    if(score < 25){
        return "Low";
    }
    if(score < 50){
        return "Moderate";
    }

    if(score < 75){
        return "High";
    }

    return "Critical";
}

export function calculateReleaseRisk(input: {
    changedFiles: number;
    affectedFiles: number;
    affectedTests: number;
    newUnresolvedImports: number;
}): ReleaseRiskResult {
    const factors: RiskFactor[] = [
        scoreChangedFiles(input.changedFiles),
        scoreAffectedFiles(input.affectedFiles),
        scoreAffectedTests(input.affectedTests),
        scoreUnresolvedImports(input.newUnresolvedImports),
    ];

    const rawScore = factors.reduce(
        (total, factor) => total + factor.points,
        0,
    );

    const maxPossibleScore = 135;
    const score = Math.round((rawScore / maxPossibleScore) * 100);

    return {
        score,
        category: getRiskCategory(score),
        factors,
    };
}