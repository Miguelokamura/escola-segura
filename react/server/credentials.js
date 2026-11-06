// As credenciais do app móvel são opcionais e devem ser configuradas no ambiente.
export const localAdmin = {
  usuario: process.env.MOBILE_ADMIN_USER || "",
  senha: process.env.MOBILE_ADMIN_PASSWORD || "",
  chaveMobile: process.env.MOBILE_API_KEY || "",
};
