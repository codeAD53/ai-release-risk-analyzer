import dotenv from "dotenv";
import express from "express";
import {resolve} from "node:path";
import { analyzeGitDiff } from "../../../packages/analysis/src/index.js";
dotenv.config({
    path: resolve(process.cwd(),"../../.env")
});

const app = express();
const port = Number(process.env.PORT ?? 4000);
const repositoryPath = process.env.DEMO_REPO_PATH;

app.use(express.json());
app.get("/health", (req,res)=>{
    res.json({status: "ok", service: "release-risk-api"});
});

app.get("/api/v1/analyze",async(req,res)=>{
    const { base, target } = req.query;
    if( typeof base !== "string" || typeof target !== "string" || !base || !target){
        res.status(400).json({
            error: "Provide both base and target commit SHAs."
        });
        return;
    }
    if(!repositoryPath){
        res.status(500).json({
            error: "DEMO_REPO_PATH is not configured"
        });
        return;
    }
    try{
        const result = await analyzeGitDiff(
            resolve(repositoryPath),
            base,target
        );
        res.json(result);
    }catch(error){
        const message = error instanceof Error ? error.message: "Unknown analysis error";
        res.status(400).json({error: message});
    }
});

app.listen(port, ()=>{
    console.log(`Release Risk API running at http://localhost:${port}`);
});