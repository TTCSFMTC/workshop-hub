import { NextResponse } from "next/server";

// Kept in sync by hand with belt-or-chain/engines.yaml (the standalone CLI
// tool this feature was ported from) — same matching approach, because the
// DVSA MOT History API doesn't return an engine code either, only
// make/fuelType/engineSize(cc)/registrationDate. Part numbers are left
// blank until verified against a trusted source — never guess one.
const ENGINES = [
  {
    name: "JLR Ingenium 2.0 diesel (D150/D180/D240 etc.)",
    makeContains: ["LAND ROVER", "JAGUAR"],
    fuel: ["DIESEL"],
    ccMin: 1990,
    ccMax: 2000,
    yearMin: 2015,
    yearMax: 2026,
    type: "chain",
    partNumber: "",
    notes: "Ingenium engines use a timing chain, not a belt — chains stretch/fail over time and this is the core job the business quotes for.",
  },
  {
    name: "JLR Ingenium 2.0 petrol",
    makeContains: ["LAND ROVER", "JAGUAR"],
    fuel: ["PETROL"],
    ccMin: 1990,
    ccMax: 2000,
    yearMin: 2015,
    yearMax: 2026,
    type: "chain",
    partNumber: "",
    notes: "Petrol Ingenium, same chain-driven design as the diesel variant.",
  },
  {
    name: "Nissan 1.2 DIG-T (HR12DDT)",
    makeContains: ["NISSAN"],
    fuel: ["PETROL"],
    ccMin: 1190,
    ccMax: 1200,
    yearMin: 2013,
    yearMax: 2026,
    type: "chain",
    partNumber: "",
    notes: "Fitted to Qashqai/Juke/Micra. Timing chain on both manual and auto gearbox variants — check the V5C or ask the customer if the job needs to know which.",
  },
  {
    name: "Ford 1.0 EcoBoost (wet belt)",
    makeContains: ["FORD"],
    fuel: ["PETROL"],
    ccMin: 995,
    ccMax: 1000,
    yearMin: 2012,
    yearMax: 2026,
    type: "belt",
    partNumber: "",
    notes: "Wet-belt design (runs in oil, not a dry accessory belt). Fitted to Fiesta, Focus, B-Max, EcoSport etc. Rated interval ~10yrs/100k miles but many fail earlier.",
  },
];

const MOT_SCOPE = "https://tapi.dvsa.gov.uk/.default";

function normalizeReg(reg) {
  return reg.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

async function getAccessToken(tenantId, clientId, clientSecret) {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: MOT_SCOPE,
    }),
  });
  if (!res.ok) throw new Error("Could not get an MOT History API access token");
  const data = await res.json();
  return data.access_token;
}

async function lookupVehicle(reg, accessToken, apiKey) {
  const res = await fetch(`https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(reg)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "X-API-Key": apiKey },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`MOT History API error (${res.status})`);
  return res.json();
}

function vehicleYear(vehicle) {
  for (const field of ["registrationDate", "manufactureDate"]) {
    const value = vehicle[field];
    if (value) {
      const year = parseInt(value.split("-")[0], 10);
      if (!Number.isNaN(year)) return year;
    }
  }
  if (vehicle.manufactureYear) {
    const year = parseInt(vehicle.manufactureYear, 10);
    if (!Number.isNaN(year)) return year;
  }
  return null;
}

function vehicleCc(vehicle) {
  if (vehicle.engineSize == null) return null;
  const cc = parseInt(vehicle.engineSize, 10);
  return Number.isNaN(cc) ? null : cc;
}

function matchesEngine(engine, make, fuel, cc, year) {
  if (!make || !engine.makeContains.some((m) => make.toUpperCase().includes(m))) return false;
  if (!fuel || !engine.fuel.includes(fuel.toUpperCase())) return false;
  if (cc == null || cc < engine.ccMin || cc > engine.ccMax) return false;
  if (year != null && (year < engine.yearMin || year > engine.yearMax)) return false;
  return true;
}

export async function POST(request) {
  const tenantId = process.env.MOT_TENANT_ID;
  const clientId = process.env.MOT_CLIENT_ID;
  const clientSecret = process.env.MOT_CLIENT_SECRET;
  const apiKey = process.env.MOT_API_KEY;
  if (!tenantId || !clientId || !clientSecret || !apiKey) {
    return NextResponse.json({ error: "MOT History API credentials are not configured on the server" }, { status: 500 });
  }

  const { reg } = await request.json();
  if (!reg || !reg.trim()) {
    return NextResponse.json({ error: "Registration is required" }, { status: 400 });
  }
  const cleanReg = normalizeReg(reg);

  let accessToken;
  try {
    accessToken = await getAccessToken(tenantId, clientId, clientSecret);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  let vehicle;
  try {
    vehicle = await lookupVehicle(cleanReg, accessToken, apiKey);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
  if (!vehicle) {
    return NextResponse.json({ error: `No vehicle found for ${cleanReg}` }, { status: 404 });
  }

  const cc = vehicleCc(vehicle);
  const year = vehicleYear(vehicle);
  const matches = ENGINES.filter((e) => matchesEngine(e, vehicle.make, vehicle.fuelType, cc, year));

  return NextResponse.json({
    reg: cleanReg,
    make: vehicle.make || null,
    model: vehicle.model || null,
    fuelType: vehicle.fuelType || null,
    cc,
    year,
    matches: matches.map((e) => ({ name: e.name, type: e.type, partNumber: e.partNumber, notes: e.notes })),
  });
}
