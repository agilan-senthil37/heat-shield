import { handle, json } from "@/lib/http";
import { dataMode, aiMode } from "@/lib/config";
export const GET = () =>
  handle(async () =>
    json({
      status: "ok",
      data_mode: dataMode(),
      ai_mode: aiMode(),
      note: "Process health only; integrations are tested separately.",
    }),
  );
