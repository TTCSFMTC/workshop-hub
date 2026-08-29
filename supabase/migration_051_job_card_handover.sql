-- The handover/collection sign-off — a legal acknowledgement that the
-- customer has inspected the vehicle and is happy with the work and its
-- condition, captured when they collect it. Reuses job_cards.signature/
-- signature_name/signature_date, which already existed but were never
-- wired up to anything. This is the one genuinely new column: where the
-- generated, signed handover PDF ends up.
alter table job_cards add column if not exists handover_pdf_url text;
