import { env } from "cloudflare:workers";
import { handleCrewRequest } from "../../../lib/crew-room";
import { publicCrewConfig } from "../../../lib/public-crew-config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleCrewRequest(request, env.DB, Date.now(), publicCrewConfig(env));
}

export async function POST(request: Request) {
  return handleCrewRequest(request, env.DB, Date.now(), publicCrewConfig(env));
}

export async function PATCH(request: Request) {
  return handleCrewRequest(request, env.DB, Date.now(), publicCrewConfig(env));
}

export async function DELETE(request: Request) {
  return handleCrewRequest(request, env.DB, Date.now(), publicCrewConfig(env));
}
