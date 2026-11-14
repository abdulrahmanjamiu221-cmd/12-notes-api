import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { JWT_SECRET } from "../config.js";
import { sql } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../lib/validate.js";

const router = Router();
const passwordSchema = z.string()
  .min(10, "Password must be at least 10 characters")
  .regex(/^(?=.*[A-Za-z])(?=.*\d)[\s\S]*$/, "Password must contain letters and numbers");

const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("A valid email is required").transform((email) => email.toLowerCase()),
  password: passwordSchema,
});

const loginSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: z.string().min(1),
});

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: { message: "Too many authentication attempts" },
    });
  },
});

router.use(authRateLimit);

router.post("/register", validate(registerSchema), async (req, res, next) => {
  const { name, email, password } = req.body;

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES (${name}, ${email}, ${passwordHash})
      RETURNING id, name, email, created_at
    `;
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, {
      expiresIn: "1h",
      algorithm: "HS256",
    });

    return res.status(201).json({ user, token });
  } catch (error) {
    if (error.code === "23505" && error.constraint === "users_email_key") {
      return res.status(409).json({
        error: { message: "An account with this email already exists" },
      });
    }

    return next(error);
  }
});

router.post("/login", async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return invalidCredentials(res);
  }

  try {
    const { email, password } = parsed.data;
    const [user] = await sql`
      SELECT id, name, email, password_hash, created_at
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `;

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return invalidCredentials(res);
    }

    const token = jwt.sign({ sub: user.id }, JWT_SECRET, {
      expiresIn: "1h",
      algorithm: "HS256",
    });

    return res.json({ token, user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const [user] = await sql`
      SELECT id, name, email, created_at
      FROM users
      WHERE id = ${req.user.id}
      LIMIT 1
    `;

    if (!user) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    return res.json({ user });
  } catch (error) {
    return next(error);
  }
});

function invalidCredentials(res) {
  return res.status(401).json({
    error: { message: "Invalid email or password" },
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    created_at: user.created_at,
  };
}

export default router;
