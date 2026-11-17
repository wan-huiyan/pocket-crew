declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    PUBLIC_CREW_VIEW_HASH?: string;
    PUBLIC_CREW_PUBLISH_HASH?: string;
    /** Optional hashed grant limited to public supporter position/sharing updates. */
    PUBLIC_CREW_LOCATION_HASH?: string;
    /** Absolute ISO timestamp; activation cannot extend this race window. */
    PUBLIC_CREW_EXPIRES_AT?: string;
  }
}
