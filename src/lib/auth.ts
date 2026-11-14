import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { dataMode } from "./config";
import { db } from "./store";
import { ApiError } from "./http";
export async function authorize(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new ApiError(
      403,
      "ORIGIN_REJECTED",
      "Use the same-origin application",
    );
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (dataMode() === "demo") {
    const expected = process.env.DEMO_ACCESS_TOKEN;
    if (process.env.NODE_ENV === "production" && !expected)
      throw new ApiError(
        503,
        "DEMO_LOCKED",
        "Set DEMO_ACCESS_TOKEN or use Supabase authentication",
      );
    if (expected) {
      const hash = (s: string) => createHash("sha256").update(s).digest();
      if (!token || !timingSafeEqual(hash(token), hash(expected)))
        throw new ApiError(401, "UNAUTHORIZED", "Valid bearer token required");
    }
    return { owner: "local-demo", token: undefined };
  }
  if (!token)
    throw new ApiError(401, "UNAUTHORIZED", "Supabase access token required");
  const { data, error } = await db(token).auth.getUser(token);
  if (error || !data.user)
    throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired session");
  return { owner: data.user.id, token };
}
const buckets = new Map<string, { count: number; until: number }>();
export function limit(owner: string) {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k);
  const b = buckets.get(owner) ?? { count: 0, until: now + 60000 };
  if (b.count >= 10)
    throw new ApiError(
      429,
      "RATE_LIMIT",
      "Ten generation requests per minute per user; retry later",
    );
  b.count++;
  buckets.set(owner, b);
}
