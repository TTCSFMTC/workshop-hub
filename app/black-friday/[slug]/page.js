import { notFound } from "next/navigation";
import { BLACK_FRIDAY_OFFERS, getBlackFridayOffer } from "@/lib/blackFridayOffers";
import { OfferDetail } from "@/components/BlackFriday";

export function generateStaticParams() {
  return BLACK_FRIDAY_OFFERS.map((o) => ({ slug: o.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const offer = getBlackFridayOffer(slug);
  return { title: offer ? `${offer.title} — Black Friday — Warrington 4x4` : "Black Friday — Warrington 4x4" };
}

export default async function BlackFridayOfferPage({ params }) {
  const { slug } = await params;
  const offer = getBlackFridayOffer(slug);
  if (!offer) notFound();
  return <OfferDetail offer={offer} />;
}
