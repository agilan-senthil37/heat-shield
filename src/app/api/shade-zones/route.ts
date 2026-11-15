import { handle, json, ApiError } from "@/lib/http";
import { shadeZones } from "@/lib/shade-zones";
import { dataMode } from "@/lib/config";

export const GET = (request: Request) => handle(async () => {
  const area = new URL(request.url).searchParams.get("study_area");
  const data = dataMode() === "supabase" && area ? shadeZones(area) : undefined;
  if (!data) throw new ApiError(404, "NO_SHADE_DATA", "No shade survey dataset for this study area.");
  return json({ data, data_mode: "supabase", source: "dry-open-ground-v1" });
});
