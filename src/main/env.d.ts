// Variáveis lidas do arquivo .env.local na hora de compilar (veja .env.example).
interface ImportMetaEnv {
  readonly MAIN_VITE_LICENSE_SERVER?: string
  readonly MAIN_VITE_LICENSE_APP_ID?: string
  readonly MAIN_VITE_LICENSE_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
