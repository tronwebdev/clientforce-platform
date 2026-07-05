import { redirect } from "next/navigation";

/** C2.1: the shell lands on Agents (handoff §C). Dashboard lives at /dashboard. */
export default function IndexPage() {
  redirect("/agents");
}
