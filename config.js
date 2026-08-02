// ============================================================
//  CONFIGURAÇÃO DO SUPABASE
// ------------------------------------------------------------
//  Enquanto estes valores forem os placeholders "YOUR_...", a app
//  guarda tudo localmente no browser (localStorage) — dá para testar
//  já, sem instalar nada.
//
//  Para sincronizar na cloud (grátis):
//   1. Cria um projeto em https://supabase.com
//   2. Corre o SQL do ficheiro  schema.sql  no SQL Editor do Supabase
//   3. Em Project Settings → API, copia o "Project URL" e a chave "anon public"
//   4. Cola-os aqui em baixo e recarrega a página
// ============================================================

export const CONFIG = {
  SUPABASE_URL: 'YOUR_SUPABASE_URL',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
};
