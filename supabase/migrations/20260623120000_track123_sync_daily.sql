-- Reschedule track123 sync from every 12h to once daily at 08:00 UTC.
-- Also covers Shopify fulfilled orders refresh (added to the same hook).
SELECT cron.unschedule('track123-sync-12h');

SELECT cron.schedule(
  'track123-sync-daily',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lojas-one.vercel.app/api/public/hooks/sync-track123',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2eGlzYWNzZmRseWV1cXl1YnFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NjMzODksImV4cCI6MjA5NjUzOTM4OX0.MASpMnBEJrji266B_Q23eYz0sFz-IIhDm5yPi7Bcq1Q"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
