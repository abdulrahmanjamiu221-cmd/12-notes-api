import { Router } from "express";
import { z } from "zod";
import { sql } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../lib/validate.js";

const router = Router();

const listQuerySchema = z.object({
  q: z.string().trim().optional(),
  tag: z.string().trim().min(1).optional(),
  pinned: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const createNoteSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  body: z.string(),
  tags: z.array(z.string().trim().min(1)).default([]),
  pinned: z.boolean().default(false),
});

const updateNoteSchema = z.object({
  title: z.string().trim().min(1, "Title cannot be empty").optional(),
  body: z.string().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  pinned: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided",
});

router.use(requireAuth);

router.get("/", validateListQuery, async (req, res, next) => {
  const { q, tag, pinned, page, limit } = res.locals.listQuery;
  const searchText = q || null;
  const selectedTag = tag ?? null;
  const selectedPinned = pinned === undefined ? null : pinned === "true";
  const offset = (page - 1) * limit;

  try {
    const [count] = await sql`
      SELECT count(*)::int AS total
      FROM notes
      WHERE 1 = 1
        AND user_id = ${req.user.id}
        AND (${searchText}::text IS NULL OR title ILIKE ('%' || ${searchText}::text || '%') OR body ILIKE ('%' || ${searchText}::text || '%'))
        AND (${selectedTag}::text IS NULL OR ${selectedTag}::text = ANY(tags))
        AND (${selectedPinned}::boolean IS NULL OR pinned = ${selectedPinned}::boolean)
    `;
    const notes = await sql`
      SELECT id, user_id, title, body, tags, pinned, created_at, updated_at
      FROM notes
      WHERE 1 = 1
        AND user_id = ${req.user.id}
        AND (${searchText}::text IS NULL OR title ILIKE ('%' || ${searchText}::text || '%') OR body ILIKE ('%' || ${searchText}::text || '%'))
        AND (${selectedTag}::text IS NULL OR ${selectedTag}::text = ANY(tags))
        AND (${selectedPinned}::boolean IS NULL OR pinned = ${selectedPinned}::boolean)
      ORDER BY pinned DESC, updated_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return res.json({
      notes,
      pagination: {
        page,
        limit,
        total: count.total,
        totalPages: Math.ceil(count.total / limit),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", validateNoteId, async (req, res, next) => {
  try {
    const [note] = await sql`
      SELECT id, user_id, title, body, tags, pinned, created_at, updated_at
      FROM notes
      WHERE id = ${req.params.id}
        AND user_id = ${req.user.id}
      LIMIT 1
    `;

    if (!note) {
      return res.status(404).json({ error: { message: "Note not found" } });
    }

    return res.json({ note });
  } catch (error) {
    return next(error);
  }
});

router.post("/", validate(createNoteSchema), async (req, res, next) => {
  const { title, body, tags, pinned } = req.body;

  try {
    const [note] = await sql`
      INSERT INTO notes (user_id, title, body, tags, pinned)
      VALUES (${req.user.id}, ${title}, ${body}, ${tags}::text[], ${pinned})
      RETURNING id, user_id, title, body, tags, pinned, created_at, updated_at
    `;

    return res.status(201).json({ note });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id", validateNoteId, validate(updateNoteSchema), async (req, res, next) => {
  const changes = req.body;

  try {
    const [note] = await sql`
      UPDATE notes
      SET title = CASE WHEN ${Object.hasOwn(changes, "title")}::boolean THEN ${changes.title ?? null}::text ELSE title END,
          body = CASE WHEN ${Object.hasOwn(changes, "body")}::boolean THEN ${changes.body ?? null}::text ELSE body END,
          tags = CASE WHEN ${Object.hasOwn(changes, "tags")}::boolean THEN ${changes.tags ?? null}::text[] ELSE tags END,
          pinned = CASE WHEN ${Object.hasOwn(changes, "pinned")}::boolean THEN ${changes.pinned ?? null}::boolean ELSE pinned END,
          updated_at = now()
      WHERE id = ${req.params.id}
        AND user_id = ${req.user.id}
      RETURNING id, user_id, title, body, tags, pinned, created_at, updated_at
    `;

    if (!note) {
      return res.status(404).json({ error: { message: "Note not found" } });
    }

    return res.json({ note });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", validateNoteId, async (req, res, next) => {
  try {
    const deleted = await sql`
      DELETE FROM notes
      WHERE id = ${req.params.id}
        AND user_id = ${req.user.id}
      RETURNING id
    `;

    if (deleted.length === 0) {
      return res.status(404).json({ error: { message: "Note not found" } });
    }

    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

function validateNoteId(req, res, next) {
  const result = z.uuid().safeParse(req.params.id);
  if (!result.success) {
    const fieldErrors = { id: result.error.issues.map((issue) => issue.message) };
    return res.status(422).json({
      error: {
        message: "Validation failed",
        details: { fieldErrors },
      },
    });
  }

  return next();
}

function validateListQuery(req, res, next) {
  const result = listQuerySchema.safeParse(req.query);
  if (!result.success) {
    const fieldErrors = {};
    for (const issue of result.error.issues) {
      const field = issue.path.length > 0 ? issue.path.join(".") : "_root";
      fieldErrors[field] ??= [];
      fieldErrors[field].push(issue.message);
    }

    return res.status(422).json({
      error: {
        message: "Validation failed",
        details: { fieldErrors },
      },
    });
  }

  res.locals.listQuery = result.data;
  return next();
}

export default router;
