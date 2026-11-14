import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "HeatShield API",
  description: "Tree planting planning backend",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui",
          maxWidth: 800,
          margin: "64px auto",
          padding: 24,
          lineHeight: 1.6,
        }}
      >
        {children}
      </body>
    </html>
  );
}
