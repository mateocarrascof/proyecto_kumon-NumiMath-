// Desarrollo local. La llave "anon" de Supabase es PÚBLICA por diseño (la protege RLS);
// esta es la llave de demostración de la base local, no una clave real.
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8000',
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
};
