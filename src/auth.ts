import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const ALLOWED_EMAIL_DOMAIN = "spacehub.id";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email;
      return typeof email === "string" && email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
    },
  },
});
