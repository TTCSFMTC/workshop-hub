import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "#16181a", color: "#f5a623", fontSize: 100, fontWeight: 800,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        W
      </div>
    ),
    { ...size }
  );
}
