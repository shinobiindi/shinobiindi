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
  metadataBase: new URL("https://shinobiindi.ezos.my"),
  icons: {
    icon: "/shinobi-logo-small-size.png",
    shortcut: "/shinobi-logo-small-size.png",
    apple: "/shinobi-logo-small-size.png",
  },
  openGraph: {
    title: "SHINOBI INDI",
    description: "Discipline. Precision. Profit.",
    url: "https://shinobiindi.ezos.my",
    siteName: "SHINOBI INDI",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
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
    images: ["/opengraph-image.png"],
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
