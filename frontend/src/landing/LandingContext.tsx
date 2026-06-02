import { createContext, useContext } from "react";

/**
 * Supplies the published page's slug to interactive blocks (the lead form) so
 * they can post to the public endpoint. In the builder/preview there's no slug,
 * so forms render but submit is disabled.
 */
export const LandingSlugContext = createContext<string | null>(null);
export const useLandingSlug = () => useContext(LandingSlugContext);
