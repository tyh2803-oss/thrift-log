/** Server-only configuration: enabling this does not change global Supabase Auth settings. */
export function registrationMode(): 'disabled' | 'preauthorized' | 'email' {
  const mode = process.env.BETA_REGISTRATION_MODE;
  return mode === 'preauthorized' || mode === 'email' ? mode : 'disabled';
}
