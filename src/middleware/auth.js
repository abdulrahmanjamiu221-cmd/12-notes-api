import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config.js";

export function requireAuth(req, res, next) {
  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    return unauthorized(res);
  }

  let payload;
  try {
    payload = jwt.verify(match[1], JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    return unauthorized(res);
  }

  if (payload === null || typeof payload !== "object" || typeof payload.sub !== "string") {
    return unauthorized(res);
  }

  req.user = { id: payload.sub };
  return next();
}

function unauthorized(res) {
  res.set("WWW-Authenticate", "Bearer");
  return res.status(401).json({
    error: { message: "Authentication required" },
  });
}
