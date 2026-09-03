import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const redirectTo = callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/";

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div
        className="w-full max-w-sm rounded-2xl border p-8 text-center"
        style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
      >
        <h1 className="mb-2 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Spacehub Occupancy Dashboard
        </h1>
        <p className="mb-6 text-sm" style={{ color: "var(--text-secondary)" }}>
          Login dengan akun Google @spacehub.id untuk mengakses dashboard.
        </p>

        {error && (
          <p className="mb-4 text-sm" style={{ color: "var(--status-critical)" }}>
            Email kamu tidak diizinkan mengakses dashboard ini. Gunakan akun Google @spacehub.id.
          </p>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ background: "var(--series-1)" }}
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </div>
  );
}
