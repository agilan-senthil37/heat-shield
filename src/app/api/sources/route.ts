import { json } from "@/lib/http";
import environment from "../../../../data/environment_sources.json";
import baseline from "../../../../data/sources.json";
export const GET = async () =>
  json({
    data: { environment, baseline },
    note: "Published GIS source catalog; per-area acquisition dates and quality flags are in site metadata.",
  });
