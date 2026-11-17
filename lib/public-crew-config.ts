import type { PublicCrewConfig } from "./crew-room";

type PublicCrewBindings = {
  PUBLIC_CREW_VIEW_HASH?: string;
  PUBLIC_CREW_PUBLISH_HASH?: string;
  PUBLIC_CREW_LOCATION_HASH?: string;
  PUBLIC_CREW_EXPIRES_AT?: string;
};

/** Shared configuration only; validation and expiry remain in crew-room. */
export function publicCrewConfig(bindings: PublicCrewBindings): PublicCrewConfig | undefined {
  if (!bindings.PUBLIC_CREW_VIEW_HASH && !bindings.PUBLIC_CREW_PUBLISH_HASH && !bindings.PUBLIC_CREW_LOCATION_HASH && !bindings.PUBLIC_CREW_EXPIRES_AT) return undefined;
  return {
    viewHash: bindings.PUBLIC_CREW_VIEW_HASH || "",
    publishHash: bindings.PUBLIC_CREW_PUBLISH_HASH || "",
    locationHash: bindings.PUBLIC_CREW_LOCATION_HASH || undefined,
    expiresAt: Date.parse(bindings.PUBLIC_CREW_EXPIRES_AT || ""),
  };
}
