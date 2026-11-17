import { env } from 'cloudflare:workers';
import { handleToiletArrivals } from '../../../lib/toilet-routing';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleToiletArrivals(request, env.DB);
}
