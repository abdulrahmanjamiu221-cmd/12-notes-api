import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import authRouter from "./routes/auth.js";
import healthRouter from "./routes/health.js";

const app = express();
const allowedOrigins = ["http://localhost:5173", "http://localhost:3000"];

app.use(helmet());
app.use(cors({ origin: allowedOrigins }));
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});
app.use(express.json({ limit: "100kb" }));

app.use("/api", healthRouter);
app.use("/api/auth", authRouter);

app.use((req, res) => {
  res.status(404).json({ error: { message: "Not found" } });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : 500;
  const message = status >= 500 && config.nodeEnv === "production"
    ? "Internal server error"
    : error.message || "Internal server error";
  const payload = { error: { message } };

  if (error.details !== undefined) {
    payload.error.details = error.details;
  }

  return res.status(status).json(payload);
});

export default app;
