import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clashero",
  description: "BIM clash coordination dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
