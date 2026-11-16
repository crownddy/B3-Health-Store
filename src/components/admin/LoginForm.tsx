"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ notProvisioned }: { notProvisioned: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Enter your email address and password.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (signInError) {
        // Deliberately generic: never reveal whether an account exists.
        setError("Invalid email address or password.");
        setSubmitting(false);
        return;
      }

      // Full reload so server components re-evaluate the session and role.
      router.replace("/admin");
      router.refresh();
    } catch {
      setError("Unable to reach the authentication service. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-login">
      <section className="admin-login-card">
        <div className="admin-login-brand">
          <Image
            src="/b3-health-store-logo.jpg"
            alt="B3 Health Store"
            width={92}
            height={92}
            priority
          />
          <div>
            <strong>B3 Health Store</strong>
            <small>Inventory management</small>
          </div>
        </div>

        <h1>Admin sign in</h1>
        <p className="admin-login-copy">
          Sign in with your B3 Health Store admin account to manage products, stock and staff.
        </p>

        {notProvisioned && (
          <p className="admin-alert admin-alert-warn" role="status">
            Your account is not provisioned for admin access. Ask a Super Admin to add a
            profile for you.
          </p>
        )}

        {error && (
          <p className="admin-alert admin-alert-error" role="alert">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <label className="admin-field">
            <span>Email address</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@b3healthstore.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              required
            />
          </label>

          <label className="admin-field">
            <span>Password</span>
            <div className="admin-password">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
                required
              />
              <button
                type="button"
                className="admin-password-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <button type="submit" className="admin-button" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="admin-login-foot">
          Access is restricted to accounts with a profile in this store. Need access? Contact
          your Super Admin.
        </p>
      </section>
    </main>
  );
}
