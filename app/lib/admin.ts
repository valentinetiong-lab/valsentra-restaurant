import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  requireEnvironmentVariable,
  validateProductionEnvironment,
} from "@/app/lib/security/environment";

validateProductionEnvironment();

const supabaseUrl = requireEnvironmentVariable("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requireEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY");

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
