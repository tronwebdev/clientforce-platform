/**
 * A3 (DEC-060): §7 skin for Clerk's components via the appearance API — the
 * login screen must be on-system (canvas #FBF7F0, card per global anatomy,
 * Bricolage heading, gradient primary, visible focus rings). Zero Clerk
 * purple anywhere: every accent resolves to the Direction E palette.
 */
const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";

export const clerkAppearance = {
  variables: {
    colorPrimary: "#16A82A",
    colorText: "#0E1512",
    colorTextSecondary: "#5C6B62",
    colorBackground: "#ffffff",
    colorInputBackground: "#ffffff",
    colorInputText: "#0E1512",
    colorDanger: "#C9543F",
    borderRadius: "12px",
    fontFamily: "'Hanken Grotesk', sans-serif",
  },
  elements: {
    rootBox: { width: "100%" },
    card: {
      background: "#ffffff",
      border: "1px solid #EBE3D6",
      borderRadius: "18px",
      boxShadow: "0 20px 60px rgba(14,21,18,.08)",
      padding: "36px 34px",
    },
    headerTitle: {
      fontFamily: "'Bricolage Grotesque', sans-serif",
      fontWeight: 800,
      fontSize: "24px",
      color: "#0E1512",
    },
    headerSubtitle: { color: "#8A7F6B", fontSize: "13.5px" },
    socialButtonsBlockButton: {
      border: "1px solid #EBE3D6",
      borderRadius: "12px",
      color: "#0E1512",
      "&:hover": { background: "#FBF7F0" },
      "&:focus-visible": { outline: "2px solid #35E834", outlineOffset: "2px" },
    },
    dividerLine: { background: "#EBE3D6" },
    dividerText: { color: "#9AA59E" },
    formFieldLabel: {
      fontSize: "11px",
      fontWeight: 800,
      color: "#9AA59E",
      textTransform: "uppercase" as const,
      letterSpacing: ".05em",
    },
    formFieldInput: {
      height: "44px",
      borderRadius: "12px",
      border: "1px solid #EBE3D6",
      fontSize: "14px",
      "&:focus": { borderColor: "#9FD8AC", boxShadow: "0 0 0 3px rgba(53,232,52,.18)" },
    },
    formButtonPrimary: {
      background: GRAD,
      color: "#0A0F0C",
      fontWeight: 700,
      fontSize: "14.5px",
      borderRadius: "12px",
      height: "46px",
      boxShadow: "0 6px 16px rgba(53,232,52,.26)",
      textTransform: "none" as const,
      "&:hover": { background: GRAD, filter: "brightness(1.03)" },
      "&:focus-visible": { outline: "2px solid #0E1512", outlineOffset: "2px" },
    },
    footerActionText: { color: "#8A7F6B" },
    footerActionLink: { color: "#16A82A", fontWeight: 700, "&:hover": { color: "#0F7A28" } },
    identityPreview: { border: "1px solid #EBE3D6", borderRadius: "12px" },
    formFieldErrorText: { color: "#C9543F" },
    alertText: { color: "#C9543F" },
    logoBox: { display: "none" },
  },
} as const;
