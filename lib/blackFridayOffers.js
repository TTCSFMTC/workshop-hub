// Content for the three Black Friday 2026 offer pages (/black-friday/*) —
// transcribed from the campaign flyers so the wording/pricing shown here
// matches what's on the ads exactly. Update this file (not the page
// components) when an offer's price or terms change.

export const BLACK_FRIDAY_CONTACT_PHONE = "07880005914";
export const BLACK_FRIDAY_CONTACT_PHONE_DISPLAY = "07880 005914";
export const BLACK_FRIDAY_CONTACT_EMAIL = "sales@w4x4.co.uk";
export const BLACK_FRIDAY_ORDER_BY = "Friday 27 November 2026";
export const BLACK_FRIDAY_ADDRESS = "27 Tatton Court, Woolston, Warrington WA1 4RR";

export const BLACK_FRIDAY_OFFERS = [
  {
    slug: "ingenium",
    badge: "Black Friday offer",
    eyebrow: "For Jaguar & Land Rover 2.0 diesel owners",
    title: "Ingenium timing chain replacement",
    banner: {
      kind: "voucher",
      heading: "+£50 high street voucher",
      sub: "With every Ingenium job completed by Friday 27 November",
    },
    price: { amount: "£1,645", suffix: "inc VAT · fixed price" },
    bullets: [
      "12-month parts & labour warranty",
      "2-week booking guarantee",
      "Febi parts used",
      "Drop off at our Woolston workshop",
    ],
    smallPrint:
      "Black Friday offer: orders placed from 2 November 2026 with work completed by Friday 27 November 2026. £50 high street voucher given on completion of the job. Drop-off at 27 Tatton Court, Woolston, WA1 4RR. Subject to availability and registration check. Additional repairs quoted separately.",
  },
  {
    slug: "ecoboost",
    badge: "Black Friday + £50 voucher",
    eyebrow: "For Ford 1.0 EcoBoost owners",
    title: "EcoBoost wet belt replacement",
    banner: {
      kind: "dropoff",
      heading: "Drop off & save",
      sub: "At our workshop – 27 Tatton Court, Woolston, WA1 4RR",
    },
    price: { amount: "£999", suffix: "inc VAT · fixed price" },
    bullets: [
      "OE-quality wet belt kit",
      "New tensioner & oil pump belt",
      "2-year parts & labour warranty",
      "2-week guaranteed booking",
    ],
    smallPrint:
      "Fixed price for Ford 1.0 EcoBoost, subject to registration check. Black Friday: £50 high street voucher with every job ordered from 2 November 2026 and completed by Friday 27 November 2026. Drop-off at 27 Tatton Court, Woolston, Warrington WA1 4RR. Additional repairs quoted before any work.",
  },
  {
    slug: "puretech",
    badge: "Black Friday + £50 voucher",
    eyebrow: "Peugeot, Citroën, Vauxhall & DS 1.2 PureTech",
    title: "PureTech wet belt replacement",
    banner: {
      kind: "dropoff",
      heading: "Drop off & save",
      sub: "At our workshop – 27 Tatton Court, Woolston, WA1 4RR",
    },
    price: { amount: "From £599", suffix: "inc VAT · price confirmed on reg" },
    bullets: [
      "Dayco wet belt kit",
      "New tensioner & idlers",
      "12-month / 12,000-mile warranty",
      "2-week guaranteed booking",
    ],
    smallPrint:
      "1.2 PureTech petrol. Price depends on engine and package, confirmed by registration check before booking. Black Friday: £50 high street voucher with every job ordered from 2 November 2026 and completed by Friday 27 November 2026. Drop-off at 27 Tatton Court, Woolston, WA1 4RR. Additional repairs quoted before any work.",
  },
];

export const getBlackFridayOffer = (slug) => BLACK_FRIDAY_OFFERS.find((o) => o.slug === slug);
