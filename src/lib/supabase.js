const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://zoejwaivyurplmbyzeaw.supabase.co';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  'sb_publishable_fznDPUWJl_OpROQMAcHPeA_GSlfo5Ya';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = { supabase };
