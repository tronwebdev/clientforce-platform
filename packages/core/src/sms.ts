/**
 * SMS segment arithmetic — the ONE estimate every surface shares. Hoisted from
 * `packages/channels/src/twilio.ts` in B2 (the Bold plan sheet shows a live
 * segment count and the web bundle cannot import the channels package — server
 * SDKs); channels re-exports from here so the send path and the UI can never
 * drift.
 */

/**
 * GSM-7 vs UCS-2 segment estimate — persisted into `Message.meta.segments`.
 * 160/153 for GSM-7, 70/67 for UCS-2 (concatenated headers eat capacity).
 */
export function smsSegmentCount(body: string): number {
  // Basic GSM-7 set + extension chars; anything else forces UCS-2.
  const gsm7 =
    /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
  const isGsm = gsm7.test(body);
  const len = body.length;
  if (len === 0) return 0;
  if (isGsm) return len <= 160 ? 1 : Math.ceil(len / 153);
  return len <= 70 ? 1 : Math.ceil(len / 67);
}
