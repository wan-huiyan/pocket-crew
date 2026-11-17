import { crewLocationPage } from "../../lib/crew-location-page";

export const dynamic = "force-dynamic";

export function GET() {
  return crewLocationPage();
}
