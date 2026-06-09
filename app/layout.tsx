import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Garden Ledger",
  description: "Record garden plants from passports, QR labels, or photo identification.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
