import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

/** A GitHub session grants access only to the configured immutable account ID. */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  callbacks: {
    signIn({ account, profile }) {
      const owner = process.env.MANAGER_OWNER_ID;
      return Boolean(
        owner &&
          /^[1-9][0-9]*$/.test(owner) &&
          account?.provider === "github" &&
          profile &&
          String(profile.id) === owner,
      );
    },
    jwt({ token, account, profile }) {
      if (account?.provider === "github" && profile?.id)
        token.sub = String(profile.id);
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
