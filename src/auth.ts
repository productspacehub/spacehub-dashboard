import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const ALLOWED_EMAIL_DOMAIN = "spacehub.id";

// Named individual exceptions to the @spacehub.id-only rule, for external
// stakeholders who need dashboard access without a spacehub.id account —
// a deliberate narrow carve-out, not a way to open the domain rule up.
// Comma-separated exact emails, set via the EXTRA_ALLOWED_EMAILS env var
// (never commit real addresses here).
const EXTRA_ALLOWED_EMAILS = new Set(
  (process.env.EXTRA_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email;
      if (typeof email !== "string") return false;
      const normalized = email.toLowerCase();
      return normalized.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`) || EXTRA_ALLOWED_EMAILS.has(normalized);
    },
  },
});
