import { handle, json } from "@/lib/http";
import { listSites } from "@/lib/store";
import { dataMode } from "@/lib/config";
import { filtersSchema } from "@/lib/regional";
export const GET = (r: Request) =>
  handle(async () => {
    const f = filtersSchema.parse(
      Object.fromEntries(new URL(r.url).searchParams),
    );
    const result = await listSites(f);
    return json({
      ...result,
      offset: f.offset,
      limit: f.limit,
      data_mode: dataMode(),
      next_offset:
        f.offset + f.limit < result.total ? f.offset + f.limit : null,
    });
  });
