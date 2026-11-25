"use client";

import React from "react";

// Workshop pack, printed from a job card: page 1 the work job card, page 2 a
// breakdown of the job (what's booked + the parts to pull), page 3 a tick
// sheet for the job. Plain black-on-white regardless of the app's dark theme —
// it's meant for a printer. Deliberately carries no printed date or time and no
// torque/spec figures (the tick sheet only has tick boxes).
//
// Pure presentation: WorkshopHub.jsx works out the reg, vehicle, booked-in list
// and parts lines from the job card + its booking and hands them in, plus the
// already-rendered work job card for page 1.

const ink = "#000";
const grey = "#555";

// Ingenium timing chain jobs (the upper chain) — strip and rebuild, oil and
// filter, code clearing and road test.
const INGENIUM_SECTIONS = [
  ["1. Before starting", [
    "Reg and job checked against the booking",
    "Pre-scan done, fault codes written down",
    "Battery support connected",
    "Kit checked: chain(s), guides, tensioner, gaskets, seals, bolts",
  ]],
  ["2. Strip", [
    "Ancillaries and covers removed",
    "Engine set to TDC and timing tools fitted",
    "Old chain, guides and tensioner removed",
    "Inspected for debris / damage / scoring",
  ]],
  ["3. Rebuild", [
    "New upper chain, guides and tensioner fitted",
    "Timing checked against marks / tools",
    "Bolts torqued to spec (new bolts where required)",
    "Gaskets / seals fitted, covers sealed",
    "Ancillaries, hoses and connectors refitted",
    "Coolant topped up / bled if disturbed",
  ]],
  ["4. Oil & filter", [
    "Old oil drained, sump plug refitted with new washer",
    "New oil filter fitted",
    "Correct oil filled - quantity used: ________ L",
  ]],
  ["5. Start up & codes", [
    "Engine turned over by hand, timing re-checked before start",
    "Started: no rattles, no leaks, oil pressure OK",
    "Fault codes read, then CLEARED",
    "Re-scanned: no codes returned",
  ]],
  ["6. Road test", [
    "Road tested to full temperature",
    "No noises, no warning lights",
    "Oil and coolant levels re-checked after test",
    "Checked for leaks, final scan clear",
  ]],
];

// Any other job: one tick per booked job, plus the usual start/finish checks.
function genericSections(bookedIn, partsLines) {
  const hasOil = partsLines.some((l) => /\boil\b/i.test(l.name));
  const hasOilFilter = partsLines.some((l) => /oil filter/i.test(l.name));
  const sections = [
    ["1. Before starting", [
      "Reg and job checked against the booking",
      "Pre-scan done, fault codes written down",
    ]],
    ["2. Work carried out", [
      ...(bookedIn.length ? bookedIn : ["Work as booked"]),
      "All parts on the breakdown sheet fitted",
    ]],
  ];
  if (hasOil || hasOilFilter) {
    sections.push(["3. Oil & filter", [
      "Old oil drained, sump plug refitted with new washer",
      ...(hasOilFilter ? ["New oil filter fitted"] : []),
      "Correct oil filled - quantity used: ________ L",
    ]]);
  }
  sections.push([`${sections.length + 1}. Codes & road test`, [
    "Fault codes read, then CLEARED",
    "Re-scanned: no codes returned",
    "Road tested to full temperature",
    "No noises, no warning lights",
    "Oil and coolant levels re-checked after test",
  ]]);
  return sections;
}

const pageStyle = { padding: "10px 18px", color: ink, background: "#fff", fontFamily: "ui-sans-serif, system-ui, Helvetica, Arial, sans-serif" };

// Big reg box at the top of the breakdown and tick sheet pages, with the
// vehicle make/model beside it.
function RegHeader({ reg, vehicle }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>REG</div>
      <div style={{ border: "2px solid #000", borderRadius: 3, minWidth: 250, height: 50, display: "flex", alignItems: "center", padding: "0 14px", fontSize: 28, fontWeight: 800, letterSpacing: "0.06em", fontFamily: "ui-monospace, Menlo, monospace" }}>
        {reg || ""}
      </div>
      {vehicle && (
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", color: grey }}>VEHICLE</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{vehicle}</div>
        </div>
      )}
    </div>
  );
}

function Box() {
  return <span style={{ display: "inline-block", width: 13, height: 13, border: "1.6px solid #000", flex: "none", boxSizing: "border-box" }} />;
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: "1px solid #888", paddingBottom: 2, marginBottom: 5, marginTop: 11 }}>{children}</div>
  );
}

export default function WorkPackPrintout({ jobCardNode, reg, vehicle, customerName, technician, bookedIn = [], symptoms, partsLines = [], customParts = [], isIngenium, ingeniumTitle }) {
  const sections = isIngenium ? INGENIUM_SECTIONS : genericSections(bookedIn, partsLines);
  const title = isIngenium ? (ingeniumTitle || "Ingenium Timing Chain Replacement") : (bookedIn.join(" + ") || "Workshop job");
  const subtitle = isIngenium ? "Upper chain - strip and rebuild, oil and filter, code clearing and road test" : "Workshop tick sheet";
  const noteLines = [0, 1];

  return (
    <div className="print-work-pack">
      {/* Page 1 — the work job card */}
      <div className="print-work-pack-page">{jobCardNode}</div>

      {/* Page 2 — breakdown of the job */}
      <div className="print-work-pack-page" style={pageStyle}>
        <RegHeader reg={reg} vehicle={vehicle} />
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "0.02em", textTransform: "uppercase" }}>Job breakdown</div>
        <div style={{ borderTop: "2px solid #000", marginTop: 6, marginBottom: 4 }} />

        <SectionTitle>Booked in for</SectionTitle>
        {bookedIn.length === 0 && <div style={{ fontSize: 13 }}>No job type set on the booking</div>}
        {bookedIn.map((n, i) => (
          <div key={i} style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{bookedIn.length > 1 ? `${i + 1}. ` : ""}{n}</div>
        ))}
        {(customerName || technician) && (
          <div style={{ fontSize: 12, color: grey, marginTop: 4 }}>
            {customerName ? `Customer: ${customerName}` : ""}{customerName && technician ? "   |   " : ""}{technician ? `Technician: ${technician}` : ""}
          </div>
        )}

        {symptoms && (
          <>
            <SectionTitle>Customer notes</SectionTitle>
            <div style={{ fontSize: 12, whiteSpace: "pre-wrap", border: "1px solid #000", borderRadius: 3, padding: 6 }}>{symptoms}</div>
          </>
        )}

        <SectionTitle>Parts needed - tick as pulled</SectionTitle>
        {partsLines.length === 0 && customParts.length === 0 && (
          <div style={{ fontSize: 12, color: grey }}>No parts recorded against this job.</div>
        )}
        {partsLines.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                {["", "Qty", "Part", "Part no.", "In stock"].map((h, i) => (
                  <th key={i} style={{ textAlign: "left", fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.04em", color: grey, padding: "2px 6px 3px 0", borderBottom: "1px solid #000", width: i === 0 ? 22 : undefined }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {partsLines.map((l) => (
                <tr key={l.partId}>
                  <td style={{ padding: "4px 6px 4px 0", borderBottom: "1px solid #ccc" }}><Box /></td>
                  <td style={{ padding: "4px 6px 4px 0", borderBottom: "1px solid #ccc", fontWeight: 700, whiteSpace: "nowrap" }}>{l.qty} {l.unit || ""}</td>
                  <td style={{ padding: "4px 6px 4px 0", borderBottom: "1px solid #ccc" }}>{l.name}</td>
                  <td style={{ padding: "4px 6px 4px 0", borderBottom: "1px solid #ccc", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5 }}>{l.partNumber || ""}</td>
                  <td style={{ padding: "4px 0", borderBottom: "1px solid #ccc", whiteSpace: "nowrap" }}>{l.stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {customParts.length > 0 && (
          <>
            <SectionTitle>Other parts (not from stock)</SectionTitle>
            {customParts.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "3px 0", borderBottom: "1px solid #ccc" }}><Box />{c}</div>
            ))}
          </>
        )}

        <SectionTitle>Extra work found / notes</SectionTitle>
        <div style={{ border: "1px solid #000", borderRadius: 3, height: 110 }} />
      </div>

      {/* Page 3 — tick sheet */}
      <div className="print-work-pack-page" style={pageStyle}>
        <RegHeader reg={reg} vehicle={vehicle} />
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "0.02em", textTransform: "uppercase" }}>{title}</div>
        <div style={{ fontSize: 11.5, color: grey, marginTop: 2 }}>{subtitle}</div>
        <div style={{ borderTop: "2px solid #000", marginTop: 6 }} />

        {sections.map(([heading, items]) => (
          <div key={heading}>
            <SectionTitle>{heading}</SectionTitle>
            {items.map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, lineHeight: "20px" }}>
                <Box />
                <span>{item}</span>
              </div>
            ))}
          </div>
        ))}

        <SectionTitle>Notes / parts used</SectionTitle>
        {noteLines.map((i) => <div key={i} style={{ borderBottom: "1px solid #bbb", height: 22 }} />)}
        <div style={{ display: "flex", gap: 30, fontSize: 12.5, marginTop: 18 }}>
          <div style={{ flex: 1 }}>Completed by: ______________________</div>
          <div style={{ flex: 1 }}>Checked by: ______________________</div>
        </div>
      </div>
    </div>
  );
}
