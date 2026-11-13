import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Context } from "hono";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Transaction } from "../../database";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:1/test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.COOKIE_SECRET ??= "approval-test-secret-at-least-32-characters";
const [database, publication, effects, { approvalProcedures }, { router }] = await Promise.all([
  import("../../database"),
  import("../../services/imagePublication"),
  import("../../services/projectEffects"),
  import("./approvals"),
  import("../../trpc"),
]);
const [images, auth, mapState, { reportProcedures }] = await Promise.all([
  import("../../lib/imageCleanup"),
  import("../../lib/auth"),
  import("../../db/projectMapState"),
  import("./reports"),
]);

const previousNodeEnv = process.env.NODE_ENV;
const overlayId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const filename = "123-example.webp";
const committed = { overlay: { filename }, before: { projectIds: [projectId], bounds: [] } };
const caller = router({ ...approvalProcedures, ...reportProcedures }).createCaller({
  user: {
    id: "33333333-3333-4333-8333-333333333333",
    email: "admin@example.com",
    username: "Admin",
    role: "admin",
    moderatedCountries: [],
    emailVerified: true,
  },
  hono: new Context(new Request("http://localhost")),
});

async function approve() {
  return await caller.setOverlayApprovalStatusWithVersion({
    id: overlayId,
    expectedVersion: 1,
    status: "approved",
  });
}

beforeEach(() => {
  process.env.NODE_ENV = "production";
  spyOn(console, "error").mockImplementation(() => undefined);
  spyOn(effects, "reconcileProjectChanges").mockResolvedValue(undefined);
  // Supply the preflight row. Transaction internals are not executed by these ordering tests.
  const proxy = drizzle(async () => ({ rows: [[filename, null, null, projectId]] }));
  spyOn(database.db, "select").mockImplementation(proxy.select.bind(proxy));
});

afterEach(() => {
  mock.restore();
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

function stubPublication() {
  return {
    copy: spyOn(publication, "copyImageToR2").mockResolvedValue(undefined),
    transaction: spyOn(database.db, "transaction").mockResolvedValue(committed),
    cleanup: spyOn(publication, "removePublishedLocalCopies").mockResolvedValue(undefined),
  };
}

test("requests publication, transaction and local cleanup in order", async () => {
  const calls = stubPublication();
  expect(await approve()).toEqual({ success: true });
  expect(calls.copy).toHaveBeenCalledWith(filename);
  expect(calls.cleanup).toHaveBeenCalledWith(filename);
  const transactionOrder = calls.transaction.mock.invocationCallOrder[0];
  const cleanupOrder = calls.cleanup.mock.invocationCallOrder[0];
  if (transactionOrder === undefined || cleanupOrder === undefined) {
    throw new Error("Approval must request both the transaction and local cleanup");
  }
  expect(calls.copy.mock.invocationCallOrder[0]).toBeLessThan(transactionOrder);
  expect(transactionOrder).toBeLessThan(cleanupOrder);
});

test("publication failure prevents the transaction and local cleanup", async () => {
  const calls = stubPublication();
  calls.copy.mockRejectedValue(new Error("R2 unavailable"));
  const failure = await approve().catch((error: unknown) => error);
  expect(failure).toHaveProperty("code", "INTERNAL_SERVER_ERROR");
  expect(calls.transaction).not.toHaveBeenCalled();
  expect(calls.cleanup).not.toHaveBeenCalled();
});

test("transaction failure prevents local cleanup", async () => {
  const calls = stubPublication();
  calls.transaction.mockRejectedValue(new Error("Commit failed"));
  const failure = await approve().catch((error: unknown) => error);
  expect(failure).toHaveProperty("code", "INTERNAL_SERVER_ERROR");
  expect(calls.copy).toHaveBeenCalledWith(filename);
  expect(calls.cleanup).not.toHaveBeenCalled();
});

function stubBan(commit: boolean) {
  let committed = false;
  const proxy = drizzle(async (query) => ({
    rows: query.startsWith("select")
      ? query.includes('from "projects"')
        ? [[projectId]]
        : [[overlayId, filename, projectId]]
      : [],
  }));
  spyOn(mapState, "captureProjectMapState").mockResolvedValue({
    projectIds: [projectId],
    bounds: [],
  });
  spyOn(auth, "deleteUserSessions").mockResolvedValue(undefined);
  spyOn(database.db, "transaction").mockImplementation(async (work) => {
    // Query responses and the commit outcome are simulated; no SQL is executed against a database.
    // oxlint-disable-next-line no-unsafe-type-assertion
    const result = await work(proxy as Transaction);
    if (!commit) throw new Error("Commit failed");
    committed = true;
    return result;
  });
  return spyOn(images, "deleteImagesEverywhere").mockImplementation(async () => {
    expect(committed).toBe(true);
  });
}

test("ban cleanup is requested only after its transaction succeeds", async () => {
  const cleanup = stubBan(true);
  await caller.banUser({ userId: projectId, reason: "Spam", deleteContent: true });
  expect(cleanup).toHaveBeenCalledWith(filename);
});

test("a failed ban transaction never requests file deletion", async () => {
  const cleanup = stubBan(false);
  const result = await caller
    .banUser({ userId: projectId, reason: "Spam", deleteContent: true })
    .catch((error: unknown) => error);
  expect(result).toHaveProperty("code", "INTERNAL_SERVER_ERROR");
  expect(cleanup).not.toHaveBeenCalled();
});
