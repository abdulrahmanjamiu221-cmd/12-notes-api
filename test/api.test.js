import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";
import request from "supertest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required. Set it to a separate Neon test branch in .env.");
}
const endpointHost = (connectionString) =>
  new URL(connectionString).hostname.replace(/-pooler(?=\.)/, "");
if (process.env.DATABASE_URL && endpointHost(process.env.DATABASE_URL) === endpointHost(testDatabaseUrl)) {
  throw new Error("TEST_DATABASE_URL must use a separate Neon branch endpoint from DATABASE_URL.");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.JWT_SECRET = "node-test-only-secret-do-not-use-outside-tests";
process.env.NODE_ENV = "test";

const { default: app } = await import("../src/app.js");
const { sql } = await import("../src/db.js");
const testEmails = [];

before(async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      title text NOT NULL,
      body text NOT NULL,
      tags text[] NOT NULL DEFAULT ARRAY[]::text[],
      pinned boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
});

after(async () => {
  for (const email of testEmails) {
    await sql`DELETE FROM users WHERE email = ${email}`;
  }
});

test("registration and login return a public user and token", async () => {
  const email = `auth-${randomUUID()}@example.test`;
  testEmails.push(email);

  const registered = await request(app)
    .post("/api/auth/register")
    .send({ name: "Test User", email: email.toUpperCase(), password: "TestPassword123" });

  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.email, email);
  assert.equal("password_hash" in registered.body.user, false);
  assert.equal(typeof registered.body.token, "string");

  const loggedIn = await request(app)
    .post("/api/auth/login")
    .send({ email: email.toUpperCase(), password: "TestPassword123" });

  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.body.user.id, registered.body.user.id);
  assert.equal("password_hash" in loggedIn.body.user, false);
  assert.equal(typeof loggedIn.body.token, "string");

  const currentUser = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${loggedIn.body.token}`);

  assert.equal(currentUser.status, 200);
  assert.equal(currentUser.body.user.id, registered.body.user.id);
});

test("notes require a valid, unexpired Bearer token", async () => {
  const missing = await request(app).get("/api/notes");
  assert.equal(missing.status, 401);
  assert.match(missing.headers["www-authenticate"], /^Bearer/);

  const garbled = await request(app)
    .get("/api/notes")
    .set("Authorization", "Bearer not-a-valid-jwt");
  assert.equal(garbled.status, 401);
  assert.match(garbled.headers["www-authenticate"], /^Bearer/);

  const expiredToken = jwt.sign(
    { sub: randomUUID() },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: -1 },
  );
  const expired = await request(app)
    .get("/api/notes")
    .set("Authorization", `Bearer ${expiredToken}`);
  assert.equal(expired.status, 401);
  assert.match(expired.headers["www-authenticate"], /^Bearer/);
});

test("note ownership is enforced for read, update, and delete", async () => {
  const ownerEmail = `owner-${randomUUID()}@example.test`;
  const otherEmail = `other-${randomUUID()}@example.test`;
  testEmails.push(ownerEmail, otherEmail);

  const [ownerRegistration, otherRegistration] = await Promise.all([
    request(app)
      .post("/api/auth/register")
      .send({ name: "Owner", email: ownerEmail, password: "OwnerPassword123" }),
    request(app)
      .post("/api/auth/register")
      .send({ name: "Other", email: otherEmail, password: "OtherPassword123" }),
  ]);
  assert.equal(ownerRegistration.status, 201);
  assert.equal(otherRegistration.status, 201);

  const created = await request(app)
    .post("/api/notes")
    .set("Authorization", `Bearer ${ownerRegistration.body.token}`)
    .send({ title: "Owner's note", body: "Private to its owner" });
  assert.equal(created.status, 201);

  const otherToken = `Bearer ${otherRegistration.body.token}`;
  const noteUrl = `/api/notes/${created.body.note.id}`;

  const otherList = await request(app)
    .get("/api/notes")
    .set("Authorization", otherToken);
  assert.equal(otherList.status, 200);
  assert.equal(otherList.body.pagination.total, 0);

  const read = await request(app).get(noteUrl).set("Authorization", otherToken);
  assert.equal(read.status, 404);

  const update = await request(app)
    .patch(noteUrl)
    .set("Authorization", otherToken)
    .send({ title: "Unauthorized update" });
  assert.equal(update.status, 404);

  const remove = await request(app).delete(noteUrl).set("Authorization", otherToken);
  assert.equal(remove.status, 404);

  const ownerRead = await request(app)
    .get(noteUrl)
    .set("Authorization", `Bearer ${ownerRegistration.body.token}`);
  assert.equal(ownerRead.status, 200);
  assert.equal(ownerRead.body.note.title, "Owner's note");
});
