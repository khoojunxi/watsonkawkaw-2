import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";

// Nunito — rounded terminals give the UI a softer, friendlier feel
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito" });

export const metadata: Metadata = {
  title: "SolarFit AI — Automated PV Layout Designer",
  description: "AI-powered solar panel layout generator for Malaysian rooftops · ESUM x RExharge Theme 3",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
