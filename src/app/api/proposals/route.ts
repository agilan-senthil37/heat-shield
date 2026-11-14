import { randomUUID } from "node:crypto";
import { handle, json, body, ApiError } from "@/lib/http";
import { site, saveProposal } from "@/lib/store";
import { explain } from "@/lib/ai";
import { proposalInput } from "@/lib/schema";
import { authorize, limit } from "@/lib/auth";
import { dataMode } from "@/lib/config";
export const runtime = "nodejs";
export const POST = (r: Request) =>
  handle(async () => {
    const user = await authorize(r);
    const input = await body(r, proposalInput);
    limit(user.owner);
    const selected = await Promise.all(
      input.selected_site_ids.map(async (id) => {
        const s = await site(id);
        if (!s.eligible)
          throw new ApiError(
            422,
            "SITE_CONFLICT",
            `Known conflict at ${s.site_code}`,
          );
        return { ...s, geometry: undefined, screening_geometry: undefined };
      }),
    );
    selected.sort(
      (a, b) => (b.priority_score ?? -1) - (a.priority_score ?? -1),
    );
    const p = {
      id: randomUUID(),
      owner_id: user.owner,
      ...input,
      created_at: new Date().toISOString(),
      sites: selected,
      explanation: await explain(selected),
      data_mode: dataMode(),
    };
    await saveProposal(p, user.token);
    return json({ data: p, pdf_url: `/api/proposals/${p.id}/pdf` }, 201);
  });
