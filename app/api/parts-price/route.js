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

export async function POST(request) {
  const apiKey = process.env.SEARCHAPI_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "SEARCHAPI_KEY is not configured on the server" }, { status: 500 });
  }

  const { partNumber, description } = await request.json();
  if (!partNumber || !partNumber.trim()) {
    return NextResponse.json({ error: "Part number is required" }, { status: 400 });
  }

  let rates;
  try {
    rates = await getExchangeRates();
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  const settled = await Promise.allSettled(
    COUNTRIES.map((country) => searchCountry(partNumber.trim(), country, apiKey))
  );

  const results = [];
  settled.forEach((outcome, i) => {
    if (outcome.status !== "fulfilled") return;
    const country = COUNTRIES[i];
    const rate = rates[country.currency];
    for (const r of outcome.value) {
      if (typeof r.extracted_price !== "number" || !rate) continue;
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

  if (results.length === 0) {
    return NextResponse.json({
      partNumber: partNumber.trim(),
      description: description || "",
      listingsFound: 0,
      cheapest: null,
    });
  }

  const cheapest = results[0];
  return NextResponse.json({
    partNumber: partNumber.trim(),
    description: description || "",
    listingsFound: results.length,
    baseCurrency: BASE_CURRENCY,
    cheapest: {
      priceBase: Math.round(cheapest.priceBase * 100) / 100,
      priceOriginal: cheapest.priceOriginal,
      currencyOriginal: cheapest.currencyOriginal,
      source: cheapest.source,
      country: cheapest.country,
      title: cheapest.title,
      link: cheapest.link,
    },
  });
}
