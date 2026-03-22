// @vitest-environment node
import { test, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";

// Mock server-only so it doesn't throw in test environment
vi.mock("server-only", () => ({}));

const JWT_SECRET = new TextEncoder().encode("development-secret-key");
const COOKIE_NAME = "auth-token";

// Mock cookie store
const mockCookieStore = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

// Import after mocks are set up
const { createSession, getSession, deleteSession, verifySession } =
  await import("@/lib/auth");

async function makeToken(
  payload: object,
  expiresIn: string = "7d"
): Promise<string> {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(JWT_SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- createSession ---

test("createSession sets an httpOnly cookie with a signed JWT", async () => {
  await createSession("user-1", "user@example.com");

  expect(mockCookieStore.set).toHaveBeenCalledOnce();
  const [name, _token, options] = mockCookieStore.set.mock.calls[0];
  expect(name).toBe(COOKIE_NAME);
  expect(options.httpOnly).toBe(true);
  expect(options.sameSite).toBe("lax");
  expect(options.path).toBe("/");
  expect(options.expires).toBeInstanceOf(Date);
});

test("createSession sets a cookie that expires in ~7 days", async () => {
  const before = Date.now();
  await createSession("user-1", "user@example.com");
  const after = Date.now();

  const [, , options] = mockCookieStore.set.mock.calls[0];
  const expiresMs = options.expires.getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  expect(expiresMs).toBeGreaterThanOrEqual(before + sevenDays - 1000);
  expect(expiresMs).toBeLessThanOrEqual(after + sevenDays + 1000);
});

test("createSession JWT contains userId and email", async () => {
  await createSession("user-42", "hello@test.com");

  const [, token] = mockCookieStore.set.mock.calls[0];
  const { jwtVerify } = await import("jose");
  const { payload } = await jwtVerify(token, JWT_SECRET);

  expect(payload.userId).toBe("user-42");
  expect(payload.email).toBe("hello@test.com");
});

// --- getSession ---

test("getSession returns null when no cookie is present", async () => {
  mockCookieStore.get.mockReturnValue(undefined);

  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns the session payload for a valid token", async () => {
  const token = await makeToken({
    userId: "user-1",
    email: "user@example.com",
    expiresAt: new Date(),
  });
  mockCookieStore.get.mockReturnValue({ value: token });

  const session = await getSession();
  expect(session).not.toBeNull();
  expect(session?.userId).toBe("user-1");
  expect(session?.email).toBe("user@example.com");
});

test("getSession returns null for an expired token", async () => {
  const token = await makeToken(
    { userId: "user-1", email: "user@example.com" },
    "-1s"
  );
  mockCookieStore.get.mockReturnValue({ value: token });

  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns null for a tampered token", async () => {
  const token = "not.a.valid.jwt";
  mockCookieStore.get.mockReturnValue({ value: token });

  const session = await getSession();
  expect(session).toBeNull();
});

// --- deleteSession ---

test("deleteSession removes the auth cookie", async () => {
  await deleteSession();

  expect(mockCookieStore.delete).toHaveBeenCalledOnce();
  expect(mockCookieStore.delete).toHaveBeenCalledWith(COOKIE_NAME);
});

// --- verifySession ---

function makeRequest(token?: string): NextRequest {
  const req = new NextRequest("http://localhost/api/test");
  if (token) {
    req.cookies.set(COOKIE_NAME, token);
  }
  return req;
}

test("verifySession returns null when no cookie is present", async () => {
  const req = makeRequest();
  const session = await verifySession(req);
  expect(session).toBeNull();
});

test("verifySession returns the session payload for a valid token", async () => {
  const token = await makeToken({
    userId: "user-2",
    email: "other@example.com",
    expiresAt: new Date(),
  });
  const req = makeRequest(token);

  const session = await verifySession(req);
  expect(session).not.toBeNull();
  expect(session?.userId).toBe("user-2");
  expect(session?.email).toBe("other@example.com");
});

test("verifySession returns null for an expired token", async () => {
  const token = await makeToken(
    { userId: "user-2", email: "other@example.com" },
    "-1s"
  );
  const req = makeRequest(token);

  const session = await verifySession(req);
  expect(session).toBeNull();
});

test("verifySession returns null for a tampered token", async () => {
  const req = makeRequest("invalid.token.here");
  const session = await verifySession(req);
  expect(session).toBeNull();
});
