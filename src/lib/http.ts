import "server-only";
import { z } from "zod";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof z.ZodError)
      return json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid fields or parameters",
            details: e.issues.map((i) => ({
              path: i.path,
              message: i.message,
            })),
          },
        },
        400,
      );
    if (e instanceof ApiError)
      return json({ error: { code: e.code, message: e.message } }, e.status);
    console.error(
      "Backend operation failed",
      e instanceof Error ? e.name : "UnknownError",
    );
    return json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message:
            "The operation failed. Check server configuration and retry.",
        },
      },
      500,
    );
  }
}
export async function body<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(415, "CONTENT_TYPE", "Use application/json");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "INVALID_JSON", "JSON body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) {
      await reader.cancel();
      throw new ApiError(413, "BODY_TOO_LARGE", "Request exceeds 16 KB");
    }
    chunks.push(value);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Malformed JSON body");
  }
  return schema.parse(parsed);
}
