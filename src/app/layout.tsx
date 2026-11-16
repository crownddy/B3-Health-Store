import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "B3 Health Store",
  description: "Your health, your wealth",
  applicationName: "B3 Health Store",
  icons: { icon: "/b3-health-store-logo.jpg" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
