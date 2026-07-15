import { NextResponse } from "next/server";

// Same markets as the parts-finder CLI tool (parts-finder/config.yaml) — keep in sync if that changes.
const COUNTRIES = [
  { gl: "uk", hl: "en", currency: "GBP" },
  { gl: "de", hl: "de", currency: "EUR" },
  { gl: "fr", hl: "fr", currency: "EUR" },
  { gl: "it", hl: "it", currency: "EUR" },
  { gl: "es", hl: "es", currency: "EUR" },
  { gl: "nl", hl: "nl", currency: "EUR" },
  { gl: "pl", hl: "pl", currency: "PLN" },
];
const BASE_CURRENCY = "GBP";
const MAX_RESULTS = 5;

async function getExchangeRates() {
  const others = [...new Set(COUNTRIES.map((c) => c.currency))].filter((c) => c !== BASE_CURRENCY);
  const rates = { [BASE_CURRENCY]: 1 };
  if (others.length === 0) return rates;
  const res = await fetch(`https://api.frankfurter.app/latest?from=${BASE_CURRENCY}&to=${others.join(",")}`);
  if (!res.ok) throw new Error("Could not fetch exchange rates");
  const data = await res.json();
  return { ...rates, ...data.rates };
}

async function searchCountry(partNumber, country, apiKey) {
  const params = new URLSearchParams({
    engine: "google_shopping",
    q: partNumber,
    gl: country.gl,
    hl: country.hl,
    api_key: apiKey,
  });
  const res = await fetch(`https://www.searchapi.io/api/v1/search?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.shopping_results || [];
}

// Google Shopping's own matching is loose — it'll happily return a listing
// that shares none of the actual part number with the query (e.g. searching
// "FEBI 193356" surfacing a totally different "FEBI BILSTEIN 48356"). Require
// every token of the query (brand words + the number itself) to actually
// appear in the listing title before trusting it as a match.
function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(Boolean);
}
function isRealMatch(partNumber, title) {
  const queryTokens = tokenize(partNumber);
  if (queryTokens.length === 0) return false;
  const titleTokens = new Set(tokenize(title));
  return queryTokens.every((t) => titleTokens.has(t));
}

// SearchApi's `condition` request param was tried and rejected — it changes
// what Google Shopping matches entirely rather than just filtering by
// condition (searching "FEBI 193356" with condition=new returned completely
// unrelated FEBI products, zero of which mentioned 193356). There's also no
// per-listing condition field in the response to filter on afterwards. A
// title keyword check is the only reliable signal available.
const USED_KEYWORDS = [
  "used", "second hand", "secondhand", "reconditioned", "recon", "refurbished",
  "refurb", "salvage", "breaker", "breaking", "part worn", "partworn",
  "pre-owned", "preowned", "takeoff", "take off", "take-off", "removed from",
  "genuine used", "ex-demo", "exdemo", "scrap",
];
function looksUsed(title) {
  const lower = title.toLowerCase();
  return USED_KEYWORDS.some((kw) => lower.includes(kw));
}

export async function POST(request) {
  const apiKey = process.env.SEARCHAPI_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "SEARCHAPI_KEY is not configured on the server" }, { status: 500 });
  }

  const { partNumber, description } = await request.json();
  if (!partNumber || !partNumber.trim()) {
    return NextResponse.json({ error: "Part number is required" }, { status: 400 });
  }
  const cleanPartNumber = partNumber.trim();

  let rates;
  try {
    rates = await getExchangeRates();
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  const settled = await Promise.allSettled(
    COUNTRIES.map((country) => searchCountry(cleanPartNumber, country, apiKey))
  );

  const results = [];
  settled.forEach((outcome, i) => {
    if (outcome.status !== "fulfilled") return;
    const country = COUNTRIES[i];
    const rate = rates[country.currency];
    for (const r of outcome.value) {
      if (typeof r.extracted_price !== "number" || !rate) continue;
      if (!isRealMatch(cleanPartNumber, r.title || "")) continue;
      if (looksUsed(r.title || "")) continue;
      results.push({
        title: r.title || "",
        source: r.seller || r.source || "unknown",
        link: r.product_link || r.link || "",
        country: country.gl.toUpperCase(),
        priceOriginal: r.extracted_price,
        currencyOriginal: country.currency,
        priceBase: r.extracted_price / rate,
      });
    }
  });

  results.sort((a, b) => a.priceBase - b.priceBase);
  const top = results.slice(0, MAX_RESULTS);

  return NextResponse.json({
    partNumber: cleanPartNumber,
    description: description || "",
    listingsFound: results.length,
    baseCurrency: BASE_CURRENCY,
    results: top.map((r) => ({
      priceBase: Math.round(r.priceBase * 100) / 100,
      priceOriginal: r.priceOriginal,
      currencyOriginal: r.currencyOriginal,
      source: r.source,
      country: r.country,
      title: r.title,
      link: r.link,
    })),
  });
}
