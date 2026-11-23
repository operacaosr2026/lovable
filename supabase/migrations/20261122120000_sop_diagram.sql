-- Processos: o fluxograma inteiro (caixinhas, setas, molduras) fica salvo num campo só.
ALTER TABLE public.sop_processes ADD COLUMN IF NOT EXISTS diagram jsonb;
