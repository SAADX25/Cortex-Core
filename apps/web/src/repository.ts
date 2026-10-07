import { fixtureRepository, type PartRepository } from '@cortex/data-access';
let repositoryPromise: Promise<PartRepository> | null = null;
export function getRepository(): Promise<PartRepository> {
  if (!repositoryPromise)
    repositoryPromise =
      import.meta.env.VITE_DATA_SOURCE === 'supabase'
        ? import('@cortex/data-access/supabase').then(({ createSupabaseRepository }) =>
            createSupabaseRepository(
              import.meta.env.VITE_SUPABASE_URL ?? '',
              import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
            ),
          )
        : Promise.resolve(fixtureRepository);
  return repositoryPromise;
}
