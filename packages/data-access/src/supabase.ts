import { createClient } from '@supabase/supabase-js';
import { catalogSchema, partSchema } from '@cortex/part-schema';
import { DataError, pageLimit, type PartRepository } from './index';

/** Read-only adapter. The security-invoker view remains protected by table RLS. */
export function createSupabaseRepository(url: string, publishableKey: string): PartRepository {
  if (!url || !publishableKey)
    throw new DataError('invalid-data', 'Supabase URL and publishable key are required.');
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async list(signal, options) {
      let query = client
        .from('catalog_records')
        .select('record')
        .order('id')
        .limit(pageLimit(options));
      if (options?.afterId) query = query.gt('id', options.afterId);
      if (options?.category) query = query.eq('category', options.category);
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw new DataError('network', 'The hardware catalog could not be retrieved.');
      const parsed = catalogSchema.safeParse(data.map((row) => row.record));
      if (!parsed.success)
        throw new DataError('invalid-data', 'The catalog contains invalid hardware data.');
      return parsed.data;
    },
    async get(id, signal) {
      let query = client.from('catalog_records').select('record').eq('id', id).limit(1);
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw new DataError('network', 'This hardware record could not be retrieved.');
      if (!data[0]) throw new DataError('missing-part', 'This hardware record is unavailable.');
      const parsed = partSchema.safeParse(data[0].record);
      if (!parsed.success)
        throw new DataError('invalid-data', 'This hardware record failed validation.');
      return parsed.data;
    },
  };
}
