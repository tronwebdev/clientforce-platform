import type { Provider } from "@nestjs/common";
import { ApolloProvider, type LeadSearchProvider } from "@clientforce/leads";

export const LEAD_PROVIDER = "LEAD_PROVIDER";

/** B6 (DEC-131): Apollo is adapter #1 behind the agnostic seam. Keyless =
 *  `configured() === false` and the surface says so — never fixture rows. */
export const leadsProviders: Provider[] = [
  { provide: LEAD_PROVIDER, useFactory: (): LeadSearchProvider => new ApolloProvider() },
];
