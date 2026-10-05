-- Per-job-type "work carried out" wording. When set, it becomes the
-- description on that job type's line of the Zoho invoice (instead of the
-- plain list of parts). Editable on the Job Types tab.
alter table job_types add column if not exists invoice_description text;

-- Diesel Ingenium timing chain replacements.
update job_types
set invoice_description = 'Remove the necessary components to access the timing chain assembly. Replace the timing chain and associated tensioner and guides, set and verify the engine timing, then reassemble using new seals and gaskets where required. Renew the engine oil and filter, run the engine, check for leaks and abnormal noise, and carry out a road test.'
where id = 'jt_timing';
