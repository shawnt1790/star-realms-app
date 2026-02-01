import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();
app.use(cors());
app.get("/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`server listening on :${port}`));
