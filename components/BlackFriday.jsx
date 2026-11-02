"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Truck, Check, MessageCircle, CalendarClock } from "lucide-react";
import { BLACK_FRIDAY_OFFERS, BLACK_FRIDAY_CONTACT_PHONE, BLACK_FRIDAY_CONTACT_PHONE_DISPLAY, BLACK_FRIDAY_CONTACT_EMAIL, BLACK_FRIDAY_ORDER_BY } from "@/lib/blackFridayOffers";

const STYLE = `
  .bf-root { background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, sans-serif; min-height: 100vh; }
  .bf-topnav { padding: 16px 20px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
  .bf-brand { font-weight: 800; font-size: 16px; display: flex; align-items: center; gap: 8px; }
  .bf-tabs { display: flex; gap: 18px; }
  .bf-tab { font-size: 14px; font-weight: 700; color: var(--muted); padding: 4px 0; }
  .bf-tab.active { color: var(--text); border-bottom: 2px solid var(--amber); }
  .bf-tab.red { color: var(--red); }
  .bf-tab.red.active { border-bottom: 2px solid var(--red); }
  .bf-layout { display: flex; gap: 24px; max-width: 920px; margin: 0 auto; padding: 20px; align-items: flex-start; }
  .bf-side { display: flex; flex-direction: column; gap: 6px; min-width: 190px; }
  .bf-side-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 700; margin-bottom: 4px; }
  .bf-side-link { padding: 10px 12px; border-radius: 8px; font-size: 14px; font-weight: 600; color: var(--text); border: 1px solid transparent; }
  .bf-side-link:hover { border-color: var(--line); }
  .bf-side-link.active { background: var(--panel); border-color: var(--red); color: var(--red); }
  .bf-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 18px; }
  .bf-badge { display: inline-block; background: #3a1210; color: var(--red); font-weight: 700; font-size: 12px; padding: 5px 10px; border-radius: 999px; width: fit-content; }
  .bf-eyebrow { color: var(--red); font-weight: 700; font-size: 13px; }
  .bf-title { font-size: 26px; font-weight: 800; line-height: 1.15; }
  .bf-banner { background: #3a1210; border: 1px solid #5c1f1a; border-radius: 10px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; }
  .bf-banner-icon { width: 34px; height: 34px; border-radius: 50%; background: var(--bg); color: var(--red); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-weight: 800; font-size: 13px; }
  .bf-banner-heading { font-weight: 700; font-size: 15px; }
  .bf-banner-sub { font-size: 12px; color: var(--muted); }
  .bf-price-row { display: flex; flex-wrap: wrap; gap: 14px; align-items: stretch; }
  .bf-price-box { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px; min-width: 180px; }
  .bf-price-amount { font-size: 30px; font-weight: 800; }
  .bf-price-note { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .bf-bullets { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 8px; }
  .bf-bullet { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; }
  .bf-ctas { display: flex; gap: 10px; flex-wrap: wrap; }
  .bf-cta { padding: 12px 18px; border-radius: 8px; font-weight: 700; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; }
  .bf-cta.primary { background: var(--amber); color: #1a1508; }
  .bf-cta.secondary { background: var(--panel2); color: var(--text); border: 1px solid var(--line); }
  .bf-smallprint { font-size: 11px; color: var(--muted); line-height: 1.5; border-top: 1px solid var(--line); padding-top: 12px; }
  .bf-contact { font-size: 12px; color: var(--muted); }
  @media (max-width: 680px) {
    .bf-layout { flex-direction: column; padding: 16px; gap: 16px; }
    .bf-side { flex-direction: row; flex-wrap: wrap; min-width: 0; width: 100%; }
    .bf-side-title { width: 100%; }
    .bf-side-link { flex: 1 1 auto; text-align: center; }
    .bf-title { font-size: 21px; }
    .bf-price-box, .bf-bullets { min-width: 0; width: 100%; }
  }
`;

const TOKENS = { "--bg": "#16181a", "--panel": "#1e2124", "--panel2": "#25292c", "--line": "#33383c", "--text": "#e7e3da", "--muted": "#9aa0a6", "--amber": "#f5a623", "--amber2": "#ffcf6b", "--red": "#e2574c", "--green": "#5fb87a" };

export function BlackFridayLayout({ children }) {
  const pathname = usePathname();
  return (
    <div style={TOKENS} className="bf-root">
      <style>{STYLE}</style>
      <div className="bf-topnav">
        <div className="bf-brand">Warrington 4x4</div>
        <div className="bf-tabs">
          <Link href="/book" className="bf-tab">Book now</Link>
          <Link href="/black-friday" className="bf-tab red active">Black Friday</Link>
        </div>
      </div>
      <div className="bf-layout">
        <div className="bf-side">
          <div className="bf-side-title">Black Friday offers</div>
          {BLACK_FRIDAY_OFFERS.map((o) => (
            <Link key={o.slug} href={`/black-friday/${o.slug}`} className={`bf-side-link${pathname === `/black-friday/${o.slug}` ? " active" : ""}`}>
              {o.title}
            </Link>
          ))}
        </div>
        <div className="bf-content">{children}</div>
      </div>
    </div>
  );
}

export function OfferSummaryCard({ offer }) {
  return (
    <Link href={`/black-friday/${offer.slug}`} className="bf-price-box" style={{ display: "block", textDecoration: "none" }}>
      <div className="bf-eyebrow">{offer.eyebrow}</div>
      <div style={{ fontWeight: 700, fontSize: 16, margin: "4px 0" }}>{offer.title}</div>
      <div className="bf-price-amount" style={{ fontSize: 22 }}>{offer.price.amount}</div>
      <div className="bf-price-note">{offer.price.suffix} — tap for details</div>
    </Link>
  );
}

export function OfferDetail({ offer }) {
  const waHref = `https://wa.me/44${BLACK_FRIDAY_CONTACT_PHONE.slice(1)}?text=${encodeURIComponent(`Hi, I'd like to get a Black Friday quote for the ${offer.title} — my reg is `)}`;
  return (
    <>
      <div>
        <span className="bf-badge">{offer.badge}</span>
      </div>
      <div>
        <div className="bf-eyebrow">{offer.eyebrow}</div>
        <div className="bf-title">{offer.title}</div>
      </div>
      <div className="bf-banner">
        <div className="bf-banner-icon">{offer.banner.kind === "voucher" ? "£50" : <Truck size={16} />}</div>
        <div>
          <div className="bf-banner-heading">{offer.banner.heading}</div>
          <div className="bf-banner-sub">{offer.banner.sub}</div>
        </div>
      </div>
      <div className="bf-price-row">
        <div className="bf-price-box">
          <div className="bf-price-amount">{offer.price.amount}</div>
          <div className="bf-price-note">{offer.price.suffix}</div>
        </div>
        <div className="bf-bullets">
          {offer.bullets.map((b) => (
            <div key={b} className="bf-bullet"><Check size={15} color="var(--green)" style={{ flexShrink: 0, marginTop: 1 }} />{b}</div>
          ))}
        </div>
      </div>
      <div className="bf-ctas">
        <a className="bf-cta primary" href={waHref} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Message us your reg</a>
        <Link className="bf-cta secondary" href="/book"><CalendarClock size={16} /> Or book online</Link>
      </div>
      <div className="bf-contact">
        {BLACK_FRIDAY_CONTACT_PHONE_DISPLAY} · warrington4x4.co.uk · {BLACK_FRIDAY_CONTACT_EMAIL} — order by {BLACK_FRIDAY_ORDER_BY} to qualify
      </div>
      <div className="bf-smallprint">{offer.smallPrint}</div>
    </>
  );
}
