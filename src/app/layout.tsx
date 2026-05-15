import type { Metadata } from "next";
import { Cinzel, JetBrains_Mono, Montserrat, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
});

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SHINOBI INDI",
  description: "Discipline. Precision. Profit.",
  metadataBase: new URL("https://shinobi.ezos.my"),
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand-tab-192.png", sizes: "192x192", type: "image/png" },
      { url: "/brand-tab-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon-32x32.png",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "SHINOBI INDI",
    description: "Discipline. Precision. Profit.",
    url: "https://shinobi.ezos.my",
    siteName: "SHINOBI INDI",
    images: [
      {
        url: "/shinobi-logo.png",
        width: 1200,
        height: 1200,
        alt: "SHINOBI INDI | Discipline. Precision. Profit.",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SHINOBI INDI",
    description: "Discipline. Precision. Profit.",
    images: ["/shinobi-logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${plusJakartaSans.variable} ${cinzel.variable} ${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
