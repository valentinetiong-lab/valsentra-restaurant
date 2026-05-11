import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Valsentra Restaurant",
  description: "Autonomous restaurant operations and revenue protection.",
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
