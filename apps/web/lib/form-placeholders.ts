/** B5 review fix 3: the prototype's authored placeholder text, by field
 *  shape — rendered on the hosted page and mirrored by the console preview
 *  (authored content, not decoration). */
export function formPlaceholder(field: { key: string; type: string }): string {
  if (field.type === "phone") return "(512) 555-0123";
  if (field.type === "email") return "you@email.com";
  if (field.type === "text" && /name/i.test(field.key)) return "Your name";
  return "Type here";
}
