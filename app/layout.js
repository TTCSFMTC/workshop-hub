import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata = {
  title: "Workshop Hub",
  description: "Booking, stock, and job card tool for the workshop.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Workshop Hub",
  },
};

export const viewport = {
  themeColor: "#16181a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
