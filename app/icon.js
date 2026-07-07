import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "#16181a",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 360, height: 360, borderRadius: 80, background: "#f5a623",
            color: "#1a1508", fontSize: 220, fontWeight: 800, fontFamily: "ui-sans-serif, system-ui, sans-serif",
          }}
        >
          W
        </div>
      </div>
    ),
    { ...size }
  );
}
