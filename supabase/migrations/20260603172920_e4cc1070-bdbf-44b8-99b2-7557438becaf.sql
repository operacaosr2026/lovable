
CREATE POLICY "app-assets own select" ON storage.objects FOR SELECT
  USING (bucket_id = 'app-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "app-assets own insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'app-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "app-assets own update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'app-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "app-assets own delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'app-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
