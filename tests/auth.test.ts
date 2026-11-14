import { it, expect, vi, afterEach } from "vitest";
const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/store", () => ({ db: () => ({ auth: { getUser } }) }));
import { authorize, limit } from "@/lib/auth";
afterEach(() => vi.unstubAllEnvs());
it("verifies Supabase tokens with the auth service", async () => {
  vi.stubEnv("DATA_MODE", "supabase");
  getUser.mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });
  expect(
    (
      await authorize(
        new Request("http://localhost", {
          headers: { authorization: "Bearer jwt" },
        }),
      )
    ).owner,
  ).toBe("user-a");
  getUser.mockResolvedValue({
    data: { user: null },
    error: { message: "expired" },
  });
  await expect(
    authorize(
      new Request("http://localhost", {
        headers: { authorization: "Bearer invalid" },
      }),
    ),
  ).rejects.toMatchObject({ status: 401 });
});
it("bounds generation per authenticated identity", () => {
  const key = crypto.randomUUID();
  for (let i = 0; i < 10; i++) limit(key);
  expect(() => limit(key)).toThrow("Ten generation");
});
