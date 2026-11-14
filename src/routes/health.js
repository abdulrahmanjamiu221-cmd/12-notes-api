import { Router } from "express";
import { sql } from "../db.js";

const router = Router();

router.get("/health", async (req, res, next) => {
  try {
    await sql`SELECT 1`;
    return res.json({ status: "ok", db: "ok" });
  } catch (error) {
    return next(error);
  }
});

export default router;
