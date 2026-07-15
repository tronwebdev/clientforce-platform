import { redirect } from "next/navigation";

/** `/backoffice` → the tenants console. */
export default function BackofficeIndex() {
  redirect("/backoffice/tenants");
}
