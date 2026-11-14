import { handle, json, body } from "@/lib/http";
import { site } from "@/lib/store";
import { explain } from "@/lib/ai";
import { explainSchema } from "@/lib/schema";
import { authorize, limit } from "@/lib/auth";
export const POST = (r: Request) =>
  handle(async () => {
    const user = await authorize(r);
    const input = await body(r, explainSchema);
    limit(user.owner);
    return json({ data: await explain([await site(input.site_id)]) });
  });
