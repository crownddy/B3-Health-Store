import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./admin.css";

export const metadata: Metadata = {
  title: "B3 Health Store",
  description: "Your health, your wealth",
  applicationName: "B3 Health Store",
  icons: { icon: "/b3-health-store-logo.jpg" }
};

/**
 * Explicit viewport so the mobile layout is predictable.
 *
 * Deliberately no `maximumScale`/`userScalable: false`: capping the zoom is an
 * accessibility regression and does not stop iOS Safari from zooming on focus
 * anyway. The real fix is keeping input text at least 16px on small screens
 * (see admin.css), which is what Safari measures.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
