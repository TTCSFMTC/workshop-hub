import { BLACK_FRIDAY_OFFERS, BLACK_FRIDAY_ORDER_BY } from "@/lib/blackFridayOffers";
import { OfferSummaryCard } from "@/components/BlackFriday";

export default function BlackFridayIndexPage() {
  return (
    <>
      <div>
        <div className="bf-title">Black Friday offers</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
          Place your order by {BLACK_FRIDAY_ORDER_BY} to qualify. Pick your job below for pricing and details.
        </div>
      </div>
      <div className="bf-price-row">
        {BLACK_FRIDAY_OFFERS.map((offer) => (
          <OfferSummaryCard key={offer.slug} offer={offer} />
        ))}
      </div>
    </>
  );
}
