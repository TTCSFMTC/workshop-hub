export default function manifest() {
  return {
    name: "Workshop Hub",
    short_name: "Workshop Hub",
    description: "Booking, stock, and job card tool for the workshop.",
    start_url: "/",
    display: "standalone",
    background_color: "#16181a",
    theme_color: "#16181a",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
