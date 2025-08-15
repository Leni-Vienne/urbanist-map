// AI : Creates a proxy to the UMD Supabase object `window.supabase` as a type-safe ESM export
// Based on the same pattern used for Leaflet CDN loading

/*
This loads the UMD Supabase script the first time that
this module is imported, which assigns the UMD Supabase object 
to `window.supabase`. This reduces bundle size by loading from CDN.
*/

// AI : Load Supabase from CDN
import 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';

// AI : Use type-only import to avoid bundling
import type * as SupabaseTypes from '@supabase/supabase-js';

// AI : Get the global supabase object with proper typing
const supabaseGlobal = (window as any).supabase as typeof SupabaseTypes;

// AI : Export all Supabase exports to maintain compatibility
export const createClient = supabaseGlobal.createClient;
export default supabaseGlobal;