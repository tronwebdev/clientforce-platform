import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { STAFF_SESSION_COOKIE } from "../../../../lib/config";

/** Clear the platform-staff session and return to the backoffice sign-in. */
export async function POST(): Promise<NextResponse> {
  const store = await cookies();
  store.delete(STAFF_SESSION_COOKIE);
  return new NextResponse(null, { status: 303, headers: { Location: "/backoffice/login" } });
}
