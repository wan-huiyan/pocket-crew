import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crow crew · Emily & Jeff",
  description: "A phone-first guide for Emily, Jeff and their cheering crew at Escape from Meriden.",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
